// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('./aws-sdk');
const fs = require('fs');
const { v4: uuidv4 } = require('./uuid');

// Store meetings in a DynamoDB table so attendees can join by meeting title
const ddb = new AWS.DynamoDB();

// Create an AWS SDK Chime object. Region 'us-east-1' is currently required.
// Use the MediaRegion property below in CreateMeeting to select the region
// the meeting is hosted in.
const chime = new AWS.Chime({ region: 'us-east-1' });

// Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
chime.endpoint = new AWS.Endpoint(process.env.CHIME_ENDPOINT);

// Read resource names from the environment
const {
  MEETINGS_TABLE_NAME,
  BROWSER_LOG_GROUP_NAME,
  BROWSER_MEETING_EVENT_LOG_GROUP_NAME,
  SQS_QUEUE_ARN,
  USE_EVENT_BRIDGE
} = process.env;

// === Handlers ===

exports.index = async (event, context, callback) => {
  // Return the contents of the index page
  return response(200, 'text/html', fs.readFileSync('./index.html', { encoding: 'utf8' }));
};

exports.join = async (event, context) => {
  const query = event.queryStringParameters;
  if (!query.title || !query.name) {
    return response(400, 'application/json', JSON.stringify({ error: 'Need parameters: title, name, region' }));
  }

  let meeting = await getMeeting(query.title);
  if (!meeting) {
    const request = {
      ClientRequestToken: uuidv4(),
      MediaRegion: 'us-east-1',
      ExternalMeetingId: query.title.substring(0, 64),
    };
    console.info('Creating new meeting: ' + JSON.stringify(request));
    meeting = await chime.createMeeting(request).promise();

    await putMeeting(query.title, meeting);
  }

  console.info('Adding new attendee');
  const attendee = (await chime.createAttendee({
    MeetingId: meeting.Meeting.MeetingId,
    ExternalUserId: `${uuidv4().substring(0, 8)}#${query.name}`.substring(0, 64),
  }).promise());

  return response(200, 'application/json', JSON.stringify({
    JoinInfo: {
      Meeting: meeting,
      Attendee: attendee,
    },
  }, null, 2));
};

exports.end = async (event, context) => {
  // Fetch the meeting by title
  const meeting = await getMeeting(event.queryStringParameters.title);

  // End the meeting. All attendee connections will hang up.
  await chime.deleteMeeting({ MeetingId: meeting.Meeting.MeetingId }).promise();
  return response(200, 'application/json', JSON.stringify({}));
};

exports.fetch_credentials = async (event, context) => {
  const awsCredentials = {
    accessKeyId: AWS.config.credentials.accessKeyId,
    secretAccessKey: AWS.config.credentials.secretAccessKey,
    sessionToken: AWS.config.credentials.sessionToken,
  };

  return response(200, 'application/json', JSON.stringify(awsCredentials));
};

exports.logs = async (event, context) => {
  return putLogEvents(event, BROWSER_LOG_GROUP_NAME, (logs, meetingId, attendeeId) => {
    const logEvents = [];
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const timestamp = new Date(log.timestampMs).toISOString();
      const message = `${timestamp} [${log.sequenceNumber}] [${log.logLevel}] [meeting: ${meetingId}] [attendee: ${attendeeId}]: ${log.message}`;
      logEvents.push({
        message: log.message,
        timestamp: log.timestampMs
      });
    }
    return logEvents;
  });
};

exports.log_meeting_event = async (event, context) => {
  return putLogEvents(event, BROWSER_MEETING_EVENT_LOG_GROUP_NAME, (logs, meetingId, attendeeId) => {
    const logEvents = [];
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      // log.message must be a JSON string. CloudWatch Logs Insights will represent
      // nested JSON fields using the dot notation, e.g. attributes.sdkVersion
      logEvents.push({
        message: log.message,
        timestamp: log.timestampMs
      });
    }
    return logEvents;
  });
};

// Called when SQS receives records of meeting events and logs out those records
exports.sqs_handler = async (event, context, callback) => {
  console.log(event.Records);
  return {};
}

// Called when EventBridge receives a meeting event and logs out the event
exports.event_bridge_handler = async (event, context, callback) => {
  console.log(event);
  return {};
}

exports.create_log_stream = async event => {
  return createLogStream(event, BROWSER_LOG_GROUP_NAME);
}

exports.create_browser_event_log_stream = async event => {
  return createLogStream(event, BROWSER_MEETING_EVENT_LOG_GROUP_NAME);
}

// === Helpers ===

// Retrieves the meeting from the table by the meeting title
async function getMeeting(title) {
  const result = await ddb.getItem({
    TableName: MEETINGS_TABLE_NAME,
    Key: {
      'Title': {
        S: title
      },
    },
  }).promise();
  return result.Item ? JSON.parse(result.Item.Data.S) : null;
}

// Stores the meeting in the table using the meeting title as the key
async function putMeeting(title, meeting) {
  await ddb.putItem({
    TableName: MEETINGS_TABLE_NAME,
    Item: {
      'Title': { S: title },
      'Data': { S: JSON.stringify(meeting) },
      'TTL': {
        N: `${Math.floor(Date.now() / 1000) + 60 * 60 * 24}` // clean up meeting record one day from now
      }
    }
  }).promise();
}

async function putLogEvents(event, logGroupName, createLogEvents) {
  const body = JSON.parse(event.body);
  if (!body.logs || !body.meetingId || !body.attendeeId || !body.appName) {
    return response(400, 'application/json', JSON.stringify({
      error: 'Required properties: logs, meetingId, attendeeId, appName'
    }));
  } else if (!body.logs.length) {
    return response(200, 'application/json', JSON.stringify({}));
  }

  const cloudWatchClient = new AWS.CloudWatchLogs({ apiVersion: '2014-03-28' });
  const putLogEventsInput = {
    logGroupName,
    logStreamName: createLogStreamName(body.meetingId, body.attendeeId),
    logEvents: createLogEvents(body.logs, body.meetingId, body.attendeeId)
  };
  const uploadSequenceToken = await ensureLogStream(cloudWatchClient, logGroupName, putLogEventsInput.logStreamName);
  if (uploadSequenceToken) {
    putLogEventsInput.sequenceToken = uploadSequenceToken;
  }

  try {
    await cloudWatchClient.putLogEvents(putLogEventsInput).promise();
  } catch (error) {
    const errorMessage = `Failed to put CloudWatch log events with error ${error} and params ${JSON.stringify(putLogEventsInput)}`;
    if (error.code === 'InvalidSequenceTokenException' || error.code === 'DataAlreadyAcceptedException') {
      console.warn(errorMessage);
    } else {
      console.error(errorMessage);
    }
  }

  return response(200, 'application/json', JSON.stringify({}));
}

// Creates log stream if necessary and returns the current sequence token
async function ensureLogStream(cloudWatchClient, logGroupName, logStreamName) {
  const logStreamsResult = await cloudWatchClient.describeLogStreams({
    logGroupName: logGroupName,
    logStreamNamePrefix: logStreamName,
  }).promise();
  const foundStream = logStreamsResult.logStreams.find(logStream => logStream.logStreamName === logStreamName);
  if (foundStream) {
    return foundStream.uploadSequenceToken;
  }
  await cloudWatchClient.createLogStream({
    logGroupName: logGroupName,
    logStreamName: logStreamName,
  }).promise();
  return null;
}

async function createLogStream(event, logGroupName) {
  const body = JSON.parse(event.body);
  if (!body.meetingId || !body.attendeeId) {
    return response(400, 'application/json', JSON.stringify({
      error: 'Required properties: meetingId, attendeeId'
    }));
  }
  const cloudWatchClient = new AWS.CloudWatchLogs({ apiVersion: '2014-03-28' });
  await cloudWatchClient.createLogStream({
    logGroupName,
    logStreamName: createLogStreamName(body.meetingId, body.attendeeId)
  }).promise();
  return response(200, 'application/json', JSON.stringify({}));
}

function createLogStreamName(meetingId, attendeeId) {
  return `ChimeSDKMeeting_${meetingId}_${attendeeId}`;
}

function response(statusCode, contentType, body) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': contentType },
    body: body,
    isBase64Encoded: false
  };
}
