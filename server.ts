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

app.post('/meetings', async (req, res) => {
  try {
    console.log(req.body);
    const meetingName = req.body.meetingName;
    if (!meetingTable.get(meetingName)) {
      const meetingResponse = await chime.createMeeting({
        ClientRequestToken: v4(),
        MediaRegion: 'us-west-2',
        ExternalMeetingId: meetingName,
      }).promise();
      meetingTable.set(meetingName, meetingResponse);
    }

    const meeting = meetingTable.get(meetingName);

    const attendee = await chime.createAttendee({
      MeetingId: meeting.Meeting.MeetingId,
      ExternalUserId: `${v4().substring(0, 8)}#${req.body.userName}`.substring(0, 64),
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