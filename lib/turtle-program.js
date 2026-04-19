const ALLOWED_COMMANDS = new Set([
  'forward',
  'backward',
  'left',
  'right',
  'penup',
  'pendown',
  'goto',
  'setheading',
  'color',
  'pensize',
  'beginfill',
  'endfill',
  'circle',
  'dot',
  'repeat',
  'home',
  'clear',
  'comment'
]);

const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey'
]);

const defaultSettings = {
  canvasWidth: 800,
  canvasHeight: 600,
  background: '#ffffff',
  speed: 4
};

function isFiniteNumber(value) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

function normalizeSettings(settings = {}) {
  return {
    canvasWidth: Number(settings.canvasWidth) || defaultSettings.canvasWidth,
    canvasHeight: Number(settings.canvasHeight) || defaultSettings.canvasHeight,
    background: typeof settings.background === 'string' ? settings.background : defaultSettings.background,
    speed: Number(settings.speed) || defaultSettings.speed
  };
}

function isSafeText(text) {
  if (typeof text !== 'string') {
    return false;
  }

  return !/(https?:\/\/|javascript:|data:|<[^>]+>)/i.test(text);
}

function isValidColor(value) {
  if (typeof value !== 'string') {
    return false;
  }

  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    return true;
  }

  return NAMED_COLORS.has(value.toLowerCase());
}

function validateProgram(program) {
  const errors = [];

  if (!program || typeof program !== 'object') {
    return { valid: false, errors: [{ line: 1, message: 'I could not find a turtle program to draw.' }] };
  }

  if (!isSafeText(program.title || '')) {
    errors.push({ message: 'The title should be plain text only.' });
  }

  if (!isSafeText(program.description || '')) {
    errors.push({ message: 'The description should be plain text only.' });
  }

  if (!isSafeText(program.explanation || '')) {
    errors.push({ message: 'The explanation should be plain text only.' });
  }

  const settings = normalizeSettings(program.settings);
  if (!isValidColor(settings.background)) {
    errors.push({ message: 'Please use a simple color for the background.' });
  }

  if (!Array.isArray(program.commands)) {
    errors.push({ message: 'I expected a list of turtle commands.' });
    return { valid: false, errors };
  }

  const state = {
    expandedCount: 0,
    maxDepth: 0,
    executionPlan: []
  };

  const validateCommands = (commands, depth) => {
    state.maxDepth = Math.max(state.maxDepth, depth);

    for (const command of commands) {
      if (!command || typeof command !== 'object') {
        errors.push({ line: command?.line, message: 'I found a command that was not in the right shape.' });
        continue;
      }

      const line = command.line;

      if (!ALLOWED_COMMANDS.has(command.cmd)) {
        errors.push({ line, message: `The command "${command.cmd}" is not allowed in this playground.` });
        continue;
      }

      switch (command.cmd) {
        case 'forward':
        case 'backward':
          if (!isFiniteNumber(command.value)) {
            errors.push({ line, message: `I expected a number for ${command.cmd}().` });
          } else if (Math.abs(command.value) > 500) {
            errors.push({ line, message: `${command.cmd}() is too big. Please use 500 or less.` });
          }
          state.expandedCount += 1;
          state.executionPlan.push({ ...command, line });
          break;
        case 'left':
        case 'right':
        case 'setheading':
        case 'pensize':
        case 'circle':
        case 'dot':
          if (!isFiniteNumber(command.value)) {
            errors.push({ line, message: `I expected a number for ${command.cmd}().` });
          }

          if (command.cmd === 'circle' && isFiniteNumber(command.value) && Math.abs(command.value) > 300) {
            errors.push({ line, message: 'circle() is too large. Please use a radius of 300 or less.' });
          }

          state.expandedCount += 1;
          state.executionPlan.push({ ...command, line });
          break;
        case 'goto':
          if (!isFiniteNumber(command.x) || !isFiniteNumber(command.y)) {
            errors.push({ line, message: 'I expected two numbers for goto(x, y).' });
          } else if (Math.abs(command.x) > 1000 || Math.abs(command.y) > 1000) {
            errors.push({ line, message: 'That goto() position is too far away. Please stay inside ±1000.' });
          }
          state.expandedCount += 1;
          state.executionPlan.push({ ...command, line });
          break;
        case 'color':
          if (!isValidColor(command.value)) {
            errors.push({ line, message: 'Please use a hex color like #ff0000 or a simple named color.' });
          }
          state.expandedCount += 1;
          state.executionPlan.push({ ...command, line });
          break;
        case 'repeat': {
          if (!Number.isInteger(command.count)) {
            errors.push({ line, message: 'repeat() needs a whole number count.' });
            break;
          }

          if (command.count < 1 || command.count > 50) {
            errors.push({ line, message: 'repeat() count must be between 1 and 50.' });
            break;
          }

          if (!Array.isArray(command.body)) {
            errors.push({ line, message: 'repeat() needs a list of commands inside { }.' });
            break;
          }

          const before = state.expandedCount;
          validateCommands(command.body, depth + 1);
          const loopBodyCount = state.expandedCount - before;
          state.expandedCount += loopBodyCount * (command.count - 1);

          const repeatedPlan = state.executionPlan.slice(-loopBodyCount);
          for (let i = 1; i < command.count; i += 1) {
            state.executionPlan.push(...repeatedPlan);
          }
          break;
        }
        case 'comment':
          if (!isSafeText(command.value || '')) {
            errors.push({ line, message: 'Comment text should be plain text only.' });
          }
          // Comments are decorative — they don't execute or count toward the command limit
          break;
        default:
          state.expandedCount += 1;
          state.executionPlan.push({ ...command, line });
          break;
      }

      if (state.expandedCount > 500) {
        errors.push({ line, message: 'This drawing has too many steps. Please keep it under 500 commands.' });
        return;
      }
    }
  };

  validateCommands(program.commands, 1);

  if (state.maxDepth > 6) {
    errors.push({ message: 'This drawing is too deeply nested. Please use fewer nested repeat blocks.' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const normalizedProgram = {
    title: typeof program.title === 'string' ? program.title : 'My Turtle Drawing',
    description: typeof program.description === 'string' ? program.description : 'A turtle drawing.',
    explanation: typeof program.explanation === 'string' ? program.explanation : 'The turtle follows each command to draw the picture.',
    settings,
    commands: program.commands
  };

  return { valid: true, program: normalizedProgram, executionPlan: state.executionPlan };
}

function formatProgram(program) {
  const formatCommand = (command, depth) => {
    const indent = '  '.repeat(depth);
    switch (command.cmd) {
      case 'forward':
      case 'backward':
      case 'left':
      case 'right':
      case 'setheading':
      case 'pensize':
      case 'circle':
      case 'dot':
        return `${indent}${command.cmd}(${command.value})`;
      case 'goto':
        return `${indent}goto(${command.x}, ${command.y})`;
      case 'color':
        return `${indent}color("${command.value}")`;
      case 'repeat': {
        const lines = [`${indent}repeat(${command.count}) {`];
        for (const nested of command.body || []) {
          lines.push(formatCommand(nested, depth + 1));
        }
        lines.push(`${indent}}`);
        return lines.join('\n');
      }
      case 'comment':
        return `${indent}# ${command.value || ''}`;
      default:
        return `${indent}${command.cmd}()`;
    }
  };

  return (program.commands || []).map((command) => formatCommand(command, 0)).join('\n');
}

function parseDisplayCode(code) {
  const lines = String(code || '').split(/\r?\n/);
  let index = 0;

  const parseBlock = (insideRepeat = false) => {
    const commands = [];

    while (index < lines.length) {
      const lineNumber = index + 1;
      const rawLine = lines[index];
      const line = rawLine.trim();
      index += 1;

      if (!line) {
        continue;
      }

      if (line === '}') {
        if (!insideRepeat) {
          return { error: { line: lineNumber, message: 'I found a closing } without a matching repeat block.' } };
        }

        return { commands };
      }

      const repeatMatch = line.match(/^repeat\((\d+)\)\s*\{$/);
      if (repeatMatch) {
        const nestedResult = parseBlock(true);
        if (nestedResult.error) {
          return nestedResult;
        }

        commands.push({
          cmd: 'repeat',
          count: Number(repeatMatch[1]),
          body: nestedResult.commands,
          line: lineNumber
        });
        continue;
      }

      const numberCommand = line.match(/^(forward|backward|left|right|setheading|pensize|circle|dot)\((-?\d+(?:\.\d+)?)\)$/);
      if (numberCommand) {
        commands.push({ cmd: numberCommand[1], value: Number(numberCommand[2]), line: lineNumber });
        continue;
      }

      const gotoCommand = line.match(/^goto\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/);
      if (gotoCommand) {
        commands.push({ cmd: 'goto', x: Number(gotoCommand[1]), y: Number(gotoCommand[2]), line: lineNumber });
        continue;
      }

      const colorCommand = line.match(/^color\(("[^"]+"|'[^']+'|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?|[a-zA-Z]+)\)$/);
      if (colorCommand) {
        const rawValue = colorCommand[1];
        const value = rawValue.startsWith('"') || rawValue.startsWith("'")
          ? rawValue.slice(1, -1)
          : rawValue;
        commands.push({ cmd: 'color', value, line: lineNumber });
        continue;
      }

      if (/^(penup|pendown|beginfill|endfill|home|clear)\(\)$/.test(line)) {
        commands.push({ cmd: line.replace('()', ''), line: lineNumber });
        continue;
      }

      const commentMatch = line.match(/^#\s*(.*)$/);
      if (commentMatch) {
        commands.push({ cmd: 'comment', value: commentMatch[1].trim(), line: lineNumber });
        continue;
      }

      if (/^repeat\(.*\)/.test(line) && !line.endsWith('{')) {
        return { error: { line: lineNumber, message: 'Line looks like repeat(), but I expected an opening { at the end.' } };
      }

      if (line.includes('{') || line.includes('}')) {
        return { error: { line: lineNumber, message: 'Please put each command on its own line and use braces only for repeat blocks.' } };
      }

      return { error: { line: lineNumber, message: `I did not understand this command: "${line}".` } };
    }

    if (insideRepeat) {
      return { error: { line: lines.length, message: 'I reached the end but still needed a closing } for repeat().' } };
    }

    return { commands };
  };

  const result = parseBlock(false);
  if (result.error) {
    return { valid: false, errors: [result.error] };
  }

  const program = {
    title: 'Edited Turtle Drawing',
    description: 'A drawing edited in the code panel.',
    explanation: 'The turtle follows your edited commands.',
    settings: { ...defaultSettings },
    commands: result.commands
  };

  const validation = validateProgram(program);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors };
  }

  return {
    valid: true,
    program: validation.program,
    executionPlan: validation.executionPlan
  };
}

function explainProgram(program) {
  const commandKinds = new Set();
  const collectKinds = (commands) => {
    for (const command of commands || []) {
      commandKinds.add(command.cmd);
      if (command.cmd === 'repeat') {
        collectKinds(command.body || []);
      }
    }
  };

  collectKinds(program.commands || []);

  const concepts = [];
  if (commandKinds.has('repeat')) {
    concepts.push('repeat loops');
  }
  if (commandKinds.has('left') || commandKinds.has('right')) {
    concepts.push('turning angles');
  }
  if (commandKinds.has('color') || commandKinds.has('beginfill')) {
    concepts.push('colors');
  }

  const conceptText = concepts.length > 0
    ? ` It uses ${concepts.join(', ')}.`
    : '';

  return `The turtle follows each line in order to make the picture.${conceptText}`;
}

module.exports = {
  ALLOWED_COMMANDS,
  defaultSettings,
  explainProgram,
  formatProgram,
  parseDisplayCode,
  validateProgram
};
