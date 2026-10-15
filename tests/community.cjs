const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const context = {
  window: {},
  Date,
  location: {
    replace() {
      throw Error('Unexpected redirect');
    },
  },
};
vm.createContext(context);
for (const file of ['chat-commands', 'account-eligibility'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
const parse = context.window.APSUCommands.parse;
for (const [text, kind, body] of [
  ['/my hand shakes', 'possessive', 'hand shakes'],
  ['/shout Hello', 'shout', 'Hello'],
  ['/help I need assistance', 'help', 'I need assistance'],
  ['/admins', 'admins', ''],
  ['/commands', 'command_list', ''],
]) {
  const command = parse(text);
  assert.equal(command.kind, kind);
  assert.equal(command.body, body);
}
for (const text of ['/help', '/admins extra', '/unknown', '/my'])
  assert.throws(() => parse(text), /Invalid Command/);
assert.equal(parse('/w 12 quiet').target, 12);
const age = context.window.APSUAccount.ageOn,
  today = new Date(2026, 9, 4);
assert.equal(age('2013-10-04', today), 13);
assert.equal(age('2013-10-05', today), 12);
assert.equal(age('2008-10-04', today), 18);
assert.equal(age('2008-10-05', today), 17);
for (const date of ['2027-01-01', '2000-02-30', '1899-12-31', ''])
  assert.equal(age(date, today), null);
assert.equal(age('2000-02-29', today), 26);
console.log('PASS: new command parsing and 13/18 birthday boundaries');
