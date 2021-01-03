import { Chime, Endpoint } from 'aws-sdk';
import { v4 } from 'uuid';
import express from 'express';
import path from 'path';

const fs = require('fs');
const key = fs.readFileSync(__dirname + '/../cert/selfsigned.key');
const cert = fs.readFileSync(__dirname + '/../cert/selfsigned.crt');
const credentials = { key: key, cert: cert };

const chime = new Chime({ region: 'us-east-1' });
chime.endpoint = new Endpoint('https://service.chime.aws.amazon.com');

let meetingTable = new Map();

const app = express();
app.use(express.json());
console.log(path.join(__dirname, "../dist"));
app.use(express.static(path.join(__dirname, "../dist")));
const http = require('http').Server(app);
const https = require('https').Server(credentials, app);

app.post('/end', async (req, res) => {
  if (!req.query.meetingId) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ error: 'Need parameters: meetingId' }));
    return;
  }
  await chime.deleteMeeting({ MeetingId: req.query.meetingId as string }).promise();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.send();
  return;
});

app.post('/join', async (req, res) => {
  try {
    const query = req.query;

    if (!query.title || !query.name) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: 'Need parameters: title, name, region' }));
      return;
    }
    
    const title = query.title as string;
    const userName = query.name as string;
    if (!meetingTable.get(title)) {
      const request = {
        ClientRequestToken: v4(),
        MediaRegion: 'us-east-1',
        ExternalMeetingId: title.substring(0, 63)
      };
      console.info('Creating new meeting: ' + JSON.stringify(request));
      const meetingResponse = await chime.createMeeting(request).promise();
      meetingTable.set(title, meetingResponse);
    }

    const meeting = meetingTable.get(title);

    const attendee = await chime.createAttendee({
      MeetingId: meeting.Meeting.MeetingId,
      ExternalUserId: `${v4().substring(0, 8)}#${userName}`.substring(0, 64),
    }).promise();

    const jsonResponse = JSON.stringify({
      JoinInfo: {
        Meeting: meeting,
        Attendee: attendee,
      },
    }, null, 2);

    console.log(jsonResponse)

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json')
    res.send(jsonResponse)

  } catch (error) {
    console.log(error)
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({
      error: 'Request failed'
    }, null, 2))
  }
});

http.listen(8080, () => console.log('Server Listening'));
https.listen(8443, () => console.log('Server Listening'));