const fs = require('node:fs');
const path = require('node:path');

const commandsDir = path.resolve(__dirname, '../src/discord/commands');
const failures = [];
for (const file of fs
  .readdirSync(commandsDir)
  .filter((name) => name.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  const options = command.data?.toJSON?.().options || [];
  let optionalSeen = false;
  for (const option of options) {
    if (option.required) {
      if (optionalSeen)
        failures.push(
          `${file}: required option '${option.name}' follows an optional option`
        );
    } else {
      optionalSeen = true;
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Discord command schemas valid: ${fs.readdirSync(commandsDir).filter((name) => name.endsWith('.js')).length}`
);
