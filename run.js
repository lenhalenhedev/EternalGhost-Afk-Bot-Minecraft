const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'log.txt');
// Ghi đè log.txt mỗi lần chạy mới (đổi thành 'a' nếu muốn giữ log cũ)
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
    shell: true,
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
