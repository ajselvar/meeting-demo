import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  AudioVideoObserver,
  MeetingSessionStatus,
  DeviceChangeObserver
} from 'amazon-chime-sdk-js';

const logger = new ConsoleLogger('MyLogger', LogLevel.INFO);
const deviceController = new DefaultDeviceController(logger);
const baseUrl = [location.protocol, '//', location.host, location.pathname.replace(/\/*$/, '/').replace('/v2', '')].join('');

let meetingConfiguration: MeetingSessionConfiguration | null = null;
let meetingResponse = null;
let meetingSession: null | DefaultMeetingSession = null;
let audioInputDevice = null;
let audioOutputDevice = null;
let videoInputDevice = null;

class DefaultDeviceChangeObserver implements DeviceChangeObserver{
  audioInputsChanged(freshAudioInputDeviceList: MediaDeviceInfo[]) {
    console.log('Audio input updated: ', freshAudioInputDeviceList);
  }
  audioOutputsChanged(freshAudioOutputDeviceList: MediaDeviceInfo[]) {
    console.log('Audio outputs updated: ', freshAudioOutputDeviceList);
  }
  videoInputsChanged(freshVideoInputDeviceList: MediaDeviceInfo[]) {
    console.log('Video inputs updated: ', freshVideoInputDeviceList);
  }
}

class DefaultAudioVideoObserver implements AudioVideoObserver {
  audioVideoDidStart() {
    console.log('AudioVideo Started');
  }

  audioVideoDidStop(sessionStatus: MeetingSessionStatus) {
    console.log(`AudioVideo Stoped ${sessionStatus}`);
  }

  audioVideoDidStartConnecting(reconnecting: Boolean) {
    if (reconnecting) {
      console.log('Attempting to reconnect');
    }
  }
}

const deviceChangeObserver = new DefaultDeviceChangeObserver();
const audioVideoObserver = new DefaultAudioVideoObserver();

window.onload = function () {
  const inputName = (document.getElementById('name') as HTMLInputElement)
  const inputMeetingId = (document.getElementById('meetingId') as HTMLInputElement);
  const buttonCreate = (document.getElementById('createButton') as HTMLButtonElement);
  const createContainer = (document.getElementById('createContainer') as HTMLDivElement);
  const audioElement = (document.getElementById('meeting-audio') as HTMLAudioElement);

  buttonCreate.addEventListener('click', async (e) => {
    e.preventDefault();
    const userName = inputName.value;
    const meetingName = inputMeetingId.value;

    if (!userName && !meetingName) {
      return;
    }

    const response = await fetch(
      `${baseUrl}join?title=${encodeURIComponent(meetingName)}&name=${encodeURIComponent(userName)}`,
      {
        method: 'POST',
      }
    );

    meetingResponse = await response.json();
    console.log(meetingResponse);
    meetingConfiguration = new MeetingSessionConfiguration(meetingResponse.JoinInfo.Meeting, meetingResponse.JoinInfo.Attendee);
    meetingSession = new DefaultMeetingSession(meetingConfiguration, logger, deviceController);

    audioInputDevice = (await meetingSession.audioVideo.listAudioInputDevices())[0];
    audioOutputDevice = (await meetingSession.audioVideo.listAudioOutputDevices())[0];
    videoInputDevice = (await meetingSession.audioVideo.listVideoInputDevices())[0];
    if (audioInputDevice?.deviceId) {
      await meetingSession.audioVideo.chooseAudioInputDevice(audioInputDevice.deviceId);
    }

    if (audioOutputDevice?.deviceId) {
      await meetingSession.audioVideo.chooseAudioOutputDevice(audioOutputDevice.deviceId);
    }

    if (videoInputDevice?.deviceId) {
      await meetingSession.audioVideo.chooseVideoInputDevice(videoInputDevice.deviceId);
    }

    meetingSession.audioVideo.addDeviceChangeObserver(deviceChangeObserver);
    meetingSession.audioVideo.bindAudioElement(audioElement);
    meetingSession.audioVideo.addObserver(audioVideoObserver);
    meetingSession.audioVideo.start();
    createContainer.style.display = 'none';
  });
}

module.exports = {};