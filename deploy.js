const { spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require("path");

let region = 'us-east-1';
let bucket = `ajselvar-meeting-deploy`;
let stack = `ajselvar-meeting-stack`;
let app = `public`;
let useEventBridge = false;
let enableTerminationProtection = false;
let disablePrintingLogs = false;
let chimeEndpoint = 'https://service.chime.aws.amazon.com'

const packages = ['aws-sdk', 'uuid',];

function ensureBucket() {
  const s3Api = spawnSync('aws', ['s3api', 'head-bucket', '--bucket', `${bucket}`, '--region', `${region}`]);
  if (s3Api.status !== 0) {
    console.log(`Creating S3 bucket ${bucket}`);
    const s3 = spawnSync('aws', ['s3', 'mb', `s3://${bucket}`, '--region', `${region}`]);
    if (s3.status !== 0) {
      console.log(`Failed to create bucket: ${s3.status}`);
      console.log((s3.stderr || s3.stdout).toString());
      process.exit(s3.status)
    }
  }
}

function spawnOrFail(command, args, options, printOutput = true) {
  options = {
    ...options,
    shell: true
  };
  const cmd = spawnSync(command, args, options);
  if (cmd.error) {
    console.log(`Command ${command} failed with ${cmd.error.code}`);
    process.exit(255);
  }
  const output = cmd.stdout.toString();
  if (printOutput) {
    console.log(output);
  }
  if (cmd.status !== 0) {
    console.log(`Command ${command} failed with exit code ${cmd.status} signal ${cmd.signal}`);
    console.log(cmd.stderr.toString());
    process.exit(cmd.status)
  }
  return output;
}

function appHtml() {
  return `./dist/index.html`
}

function ensureApp(appName) {
  console.log(`Verifying application ${appName}`);
  if (!fs.existsSync(`./${appName}`)) {
    console.log(`Application ${appName} does not exist. Did you specify correct name?`);
    process.exit(1);
  }
  if (!fs.existsSync(`./dist/index.html`)) {
    console.log(`Application ./dist/index.html does not exist. Rebuilding demo apps`);
    spawnOrFail('npm', ['run', 'build'], { cwd: path.join(__dirname) });
  }
}

function ensureTools() {
  spawnOrFail('aws', ['--version']);
  spawnOrFail('sam', ['--version']);
  spawnOrFail('npm', ['install']);
}

ensureTools();
ensureApp(app);

if (!fs.existsSync('build')) {
  fs.mkdirSync('build');
}

console.log(`Using region ${region}, bucket ${bucket}, stack ${stack}, endpoint ${chimeEndpoint}, enable-termination-protection ${enableTerminationProtection}, disable-printing-logs ${disablePrintingLogs}`);
ensureBucket();

for (const package of packages) {
  spawnOrFail('npm', ['install', '--production'], { cwd: path.join(__dirname, 'node_modules', package) });
  fs.removeSync(path.join(__dirname, 'src', package));
  fs.copySync(path.join(__dirname, 'node_modules', package), path.join(__dirname, 'src', package));
}

fs.copySync(appHtml(), 'src/index.html');

spawnOrFail('sam', ['package', '--s3-bucket', `${bucket}`,
  `--output-template-file`, `build/packaged.yaml`,
  '--region', `${region}`]);
console.log('Deploying serverless application');
spawnOrFail('sam', ['deploy', '--template-file', './build/packaged.yaml', '--stack-name', `${stack}`,
  '--parameter-overrides', `UseEventBridge=${useEventBridge} ChimeEndpoint=${chimeEndpoint}`,
  '--capabilities', 'CAPABILITY_IAM', '--region', `${region}`, '--no-fail-on-empty-changeset'], null, !disablePrintingLogs);
if (enableTerminationProtection) {
  spawnOrFail('aws', ['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', `${stack}`], null, false);
}
if (!disablePrintingLogs) {
  console.log('Amazon Chime SDK Meeting Demo URL: ');
}
const output = spawnOrFail('aws', ['cloudformation', 'describe-stacks', '--stack-name', `${stack}`,
  '--query', 'Stacks[0].Outputs[0].OutputValue', '--output', 'text', '--region', `${region}`], null, !disablePrintingLogs);
if (app === 'meeting' && !disablePrintingLogs) {
  console.log(output.replace(/Prod/, 'Prod/v2'));
}
