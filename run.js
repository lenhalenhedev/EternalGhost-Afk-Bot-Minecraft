const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Write runtime output under logs/ (gitignored) instead of an unignored
// log.txt in the repo root so build/startup output can never be committed
// accidentally (EG-013).
const logDir = path.join(__dirname, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'run.log');
// Overwrite run.log on each fresh run (use 'a' to append).
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

// Danh sách các bước cần chạy tuần tự
const steps = [
  { cmd: 'npm', args: ['install'], cwd: path.join(__dirname, 'web') },
  { cmd: 'npm', args: ['run', 'build:web'], cwd: __dirname },
  { cmd: 'npm', args: ['run', 'start'], cwd: __dirname },
];

function runStep(index) {
  if (index >= steps.length) {
    log('✅ Tất cả các bước đã chạy xong.');
    logStream.end();
    return;
  }

  const step = steps[index];
  const fullCmd = `${step.cmd} ${step.args.join(' ')}`;
  log(`▶️  Đang chạy: ${fullCmd} (cwd: ${step.cwd})`);

  const child = spawn(step.cmd, step.args, {
    cwd: step.cwd,
    // No shell: the command and arguments are fixed literals, so invoking a
    // shell adds an unnecessary indirection surface (EG-013).
    shell: false,
  });

  child.stdout.on('data', (data) => {
    logStream.write(data);
    process.stdout.write(data);
  });

  child.stderr.on('data', (data) => {
    logStream.write(data);
    process.stderr.write(data);
  });

  child.on('close', (code) => {
    if (code !== 0) {
      log(`❌ Lệnh "${fullCmd}" thoát với mã lỗi ${code}. Dừng lại.`);
      logStream.end();
      process.exit(code);
    } else {
      log(`✔️  Hoàn thành: ${fullCmd}`);
      runStep(index + 1);
    }
  });

  child.on('error', (err) => {
    log(`❌ Lỗi khi chạy "${fullCmd}": ${err.message}`);
    logStream.end();
    process.exit(1);
  });
}

runStep(0);
