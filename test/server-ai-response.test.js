const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAiTurtleResponse } = require('../server');

test('parseAiTurtleResponse parses structured AI JSON with explanation', () => {
  const raw = JSON.stringify({
    title: 'Robot',
    description: 'A friendly robot.',
    explanation: 'The turtle drew a box body, then two arms and a smiling face.',
    commands: [
      { cmd: 'penup' },
      { cmd: 'home' },
      { cmd: 'pendown' }
    ]
  });

  const result = parseAiTurtleResponse(raw);

  assert.equal(result.title, 'Robot');
  assert.equal(result.description, 'A friendly robot.');
  assert.match(result.explanation, /turtle drew/i);
  assert.equal(result.commands.length, 3);
});

test('parseAiTurtleResponse still supports legacy array output', () => {
  const raw = JSON.stringify([
    { cmd: 'penup' },
    { cmd: 'home' },
    { cmd: 'pendown' }
  ]);

  const result = parseAiTurtleResponse(raw);

  assert.equal(result.commands.length, 3);
  assert.equal(result.title, undefined);
});
