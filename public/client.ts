import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  AudioVideoObserver,
  MeetingSessionStatus,
  DeviceChangeObserver,
  AsyncScheduler,
  VideoTileState
} from 'amazon-chime-sdk-js';

const logger = new ConsoleLogger('MyLogger', LogLevel.INFO);
const deviceController = new DefaultDeviceController(logger);
const baseUrl = [location.protocol, '//', location.host, location.pathname.replace(/\/*$/, '/').replace('/v2', '')].join('');

let meetingConfiguration: MeetingSessionConfiguration | null = null;
let meetingResponse= null;
let meetingId: string;
let meetingSession: null | DefaultMeetingSession = null;
let audioInputDevice = null;
let audioOutputDevice = null;
let videoInputDevice: MediaDeviceInfo = null;

let buttonStates: { [key: string]: boolean } = {
  'button-microphone': true,
  'button-camera': true,
  'button-speaker': true,
};

class DefaultDeviceChangeObserver implements DeviceChangeObserver {
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

  private tiles: { [id: number]: number } = {};

  constructor(
    readonly videoElements: Array<HTMLVideoElement>
  ) { }

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

  videoTileDidUpdate(tileState: VideoTileState) {
    if (!tileState.boundAttendeeId || !tileState.localTile) {
      console.error('Invalid state')
    }

    const tileIndex = tileState.localTile ? 0 : this.acquireTileIndex(tileState.tileId);
    const videoElement = this.videoElements[tileIndex];
    meetingSession.audioVideo.bindVideoElement(tileState.tileId, videoElement);
  }

  acquireTileIndex(tileId: number): number {
    for (let index = 1; index < 10; index++) {
      if (this.tiles[index] === tileId) {
        return index;
      }
    }
    for (let index = 1; index < 10; index++) {
      if (!(index in this.tiles)) {
        this.tiles[index] = tileId;
        return index;
      }
    }
    throw new Error('no tiles are available');
  }

  releaseTileIndex(tileId: number): number {
    for (let index = 1; index <= 10; index++) {
      if (this.tiles[index] === tileId) {
        delete this.tiles[index];
        return index;
      }
    }
  }

}

const deviceChangeObserver = new DefaultDeviceChangeObserver();

window.onload = function () {
  const inputName = (document.getElementById('name') as HTMLInputElement)
  const inputMeetingId = (document.getElementById('meetingId') as HTMLInputElement);
  const buttonCreate = (document.getElementById('createButton') as HTMLButtonElement);
  const createContainer = (document.getElementById('createContainer') as HTMLDivElement);
  const meetingContainer = (document.getElementById('flow-meeting') as HTMLDivElement);
  const audioElement = (document.getElementById('meeting-audio') as HTMLAudioElement);
  const videoElements: Array<HTMLVideoElement> = Array.from(Array(10).keys())
    .map((index) => (document.getElementById(`video-${index}`) as HTMLVideoElement));

  const audioVideoObserver = new DefaultAudioVideoObserver(videoElements);


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
    meetingId = meetingResponse.JoinInfo.Meeting.MeetingId;
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
    meetingSession.audioVideo.startLocalVideoTile();
    createContainer.style.display = 'none';
    displayButtonStates();
    meetingContainer.style.display = 'block';
  });

  // MeetingControl

  const buttonMute = document.getElementById('button-microphone');
  buttonMute.addEventListener('mousedown', _e => {
    if (toggleButton('button-microphone')) {
      meetingSession.audioVideo.realtimeUnmuteLocalAudio();
    } else {
      meetingSession.audioVideo.realtimeMuteLocalAudio();
    }
  });

  const buttonSpeaker = document.getElementById('button-speaker');
  buttonSpeaker.addEventListener('click', e => {
    new AsyncScheduler().start(async () => {
      if (toggleButton('button-speaker')) {
        try {
          meetingSession.audioVideo.bindAudioElement(audioElement);
        } catch (error) {
          console.error(`Unable to bind audio element`, error);
        }
      } else {
        meetingSession.audioVideo.unbindAudioElement();
      }
    });
  });

  const buttonVideo = document.getElementById('button-camera');
  buttonVideo.addEventListener('click', function () {
    new AsyncScheduler().start(async function () {
      if (toggleButton('button-camera')) {
        console.error('Start')
        await meetingSession.audioVideo.chooseVideoInputDevice(videoInputDevice.deviceId);
        meetingSession.audioVideo.startLocalVideoTile();
      } else {
        console.error('Stop')
        meetingSession.audioVideo.stopLocalVideoTile();
      }
    });
  });

  const buttonLeave = (document.getElementById('button-meeting-leave') as HTMLButtonElement);
  buttonLeave.addEventListener('click', function () {
    new AsyncScheduler().start(async function () {
      buttonLeave.disabled = true;
      meetingSession.audioVideo.stop();
      buttonLeave.disabled = false;
    });
  });

  const buttonEnd = (document.getElementById('button-meeting-end') as HTMLButtonElement);
  buttonLeave.addEventListener('click', function () {
    new AsyncScheduler().start(async function () {
      buttonEnd.disabled = true;
      meetingSession.audioVideo.stop();
      await endMeeting(meetingId)
      buttonEnd.disabled = false;
    });
  });
}

async function endMeeting(meetingId: string): Promise < any > {
  await fetch(`${baseUrl}end?meetingId=${encodeURIComponent(meetingId)}`, { method: 'POST' });
}



function toggleButton(button: string, state?: 'on' | 'off'): boolean {
  if (state === 'on') {
    buttonStates[button] = true;
  } else if (state === 'off') {
    buttonStates[button] = false;
  } else {
    buttonStates[button] = !buttonStates[button];
  }
  displayButtonStates();
  return buttonStates[button];
}

function displayButtonStates(): void {
  for (const button in buttonStates) {
    const element = document.getElementById(button);
    const drop = document.getElementById(`${button}-drop`);
    const on = buttonStates[button];

    element.classList.add(on ? 'btn-success' : 'btn-outline-secondary');
    element.classList.remove(on ? 'btn-outline-secondary' : 'btn-success');

    (element.firstElementChild as SVGElement).classList.add(on ? 'svg-active' : 'svg-inactive');
    (element.firstElementChild as SVGElement).classList.remove(
      on ? 'svg-inactive' : 'svg-active'
    );

    if (drop) {
      drop.classList.add(on ? 'btn-success' : 'btn-outline-secondary');
      drop.classList.remove(on ? 'btn-outline-secondary' : 'btn-success');
    }
  }
}

module.exports = {};