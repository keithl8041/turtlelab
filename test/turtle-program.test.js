const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatProgram,
  parseDisplayCode,
  validateProgram
} = require('../lib/turtle-program');

test('parseDisplayCode parses repeat blocks and validates output', () => {
  const code = [
    'penup()',
    'goto(-100, -50)',
    'pendown()',
    'repeat(4) {',
    '  forward(100)',
    '  right(90)',
    '}'
  ].join('\n');

  const result = parseDisplayCode(code);
  assert.equal(result.valid, true);
  assert.equal(result.program.commands[3].cmd, 'repeat');
  assert.equal(result.program.commands[3].count, 4);
  assert.equal(result.executionPlan.length, 11);
  assert.equal(result.executionPlan[1].x, -100);
  const forwardCommands = result.executionPlan.filter((command) => command.cmd === 'forward' && command.value === 100);
  const rightCommands = result.executionPlan.filter((command) => command.cmd === 'right' && command.value === 90);
  assert.equal(forwardCommands.length, 4);
  assert.equal(rightCommands.length, 4);
});

test('parseDisplayCode returns child-friendly syntax errors with line number', () => {
  const result = parseDisplayCode('forward()');
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].line, 1);
  assert.match(result.errors[0].message, /did not understand|expected/i);
});

test('validateProgram blocks unsafe explanation text and invalid colors', () => {
  const result = validateProgram({
    title: 'Unsafe',
    description: 'Testing',
    explanation: '<script>alert(1)</script>',
    settings: { background: '#ffffff' },
    commands: [{ cmd: 'color', value: 'javascript:alert(1)', line: 1 }]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /explanation/.test(error.message)));
  assert.ok(result.errors.some((error) => /hex color|named color/.test(error.message)));
});

test('validateProgram rejects command counts above expansion limit', () => {
  const result = validateProgram({
    title: 'Too many',
    description: 'Too many',
    explanation: 'Too many commands',
    settings: { background: '#ffffff' },
    commands: [
      {
        cmd: 'repeat',
        count: 51,
        body: [{ cmd: 'forward', value: 10, line: 2 }],
        line: 1
      }
    ]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /between 1 and 50/.test(error.message)));
});

test('formatProgram outputs repeat blocks in child-facing DSL', () => {
  const code = formatProgram({
    commands: [
      { cmd: 'penup' },
      {
        cmd: 'repeat',
        count: 2,
        body: [{ cmd: 'forward', value: 50 }]
      }
    ]
  });

  assert.match(code, /repeat\(2\) \{/);
  assert.match(code, /forward\(50\)/);
});

test('goto execution plan entry does not include a heading field that would alter turtle heading', () => {
  const result = validateProgram({
    title: 'Test',
    description: 'Test',
    explanation: 'Test',
    settings: { background: '#ffffff' },
    commands: [
      { cmd: 'setheading', value: 45, line: 1 },
      { cmd: 'goto', x: 100, y: 50, line: 2 }
    ]
  });

  assert.equal(result.valid, true);
  const gotoEntry = result.executionPlan.find((c) => c.cmd === 'goto');
  assert.ok(gotoEntry, 'goto command should appear in execution plan');
  assert.equal(gotoEntry.x, 100);
  assert.equal(gotoEntry.y, 50);
  // goto must not include a heading field; the turtle's heading is preserved at runtime
  assert.equal('heading' in gotoEntry, false);
});

test('goto in parsed display code does not include a heading field that would alter turtle heading', () => {
  const code = [
    'setheading(90)',
    'penup()',
    'goto(200, 0)',
    'pendown()',
    'forward(50)'
  ].join('\n');

  const result = parseDisplayCode(code);
  assert.equal(result.valid, true);
  assert.equal(result.executionPlan.length, 5);

  const gotoEntry = result.executionPlan.find((c) => c.cmd === 'goto');
  assert.ok(gotoEntry, 'goto command should appear in execution plan');
  assert.equal(gotoEntry.x, 200);
  assert.equal(gotoEntry.y, 0);
  // The execution plan entry for goto must not carry heading information,
  // confirming that goto does not alter the turtle's heading
  assert.equal('heading' in gotoEntry, false);
});

test('goto inside a repeat block expands correctly in execution plan without heading side effects', () => {
  const result = validateProgram({
    title: 'Test',
    description: 'Test',
    explanation: 'Test',
    settings: { background: '#ffffff' },
    commands: [
      {
        cmd: 'repeat',
        count: 3,
        body: [
          { cmd: 'goto', x: 50, y: 50, line: 2 }
        ],
        line: 1
      }
    ]
  });

  assert.equal(result.valid, true);
  assert.equal(result.executionPlan.length, 3);
  for (const entry of result.executionPlan) {
    assert.equal(entry.cmd, 'goto');
    assert.equal(entry.x, 50);
    assert.equal(entry.y, 50);
    // Each repeated goto entry must not carry a heading field
    assert.equal('heading' in entry, false);
  }
});
