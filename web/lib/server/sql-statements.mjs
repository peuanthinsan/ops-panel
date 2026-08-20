export function splitSqlStatements(source) {
  const input = String(source || '');
  const statements = [];
  let start = 0;
  let index = 0;
  let state = 'normal';
  let blockDepth = 0;
  let dollarTag = '';

  const pushStatement = end => {
    const statement = input.slice(start, end).trim();
    if (statement) statements.push(statement);
  };

  while (index < input.length) {
    const character = input[index];
    const next = input[index + 1];

    if (state === 'single') {
      if (character === "'" && next === "'") { index += 2; continue; }
      if (character === "'") state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'double') {
      if (character === '"' && next === '"') { index += 2; continue; }
      if (character === '"') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'line-comment') {
      if (character === '\n') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (character === '/' && next === '*') { blockDepth += 1; index += 2; continue; }
      if (character === '*' && next === '/') {
        blockDepth -= 1;
        index += 2;
        if (!blockDepth) state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }
    if (state === 'dollar') {
      if (input.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = 'normal';
      } else index += 1;
      continue;
    }

    if (character === "'") { state = 'single'; index += 1; continue; }
    if (character === '"') { state = 'double'; index += 1; continue; }
    if (character === '-' && next === '-') { state = 'line-comment'; index += 2; continue; }
    if (character === '/' && next === '*') { state = 'block-comment'; blockDepth = 1; index += 2; continue; }
    if (character === '$') {
      const tag = input.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) { dollarTag = tag; state = 'dollar'; index += tag.length; continue; }
    }
    if (character === ';') {
      pushStatement(index);
      start = index + 1;
    }
    index += 1;
  }

  if (state === 'single' || state === 'double' || state === 'block-comment' || state === 'dollar') {
    throw new Error('Migration contains an unterminated quoted value or comment.');
  }
  pushStatement(input.length);
  return statements;
}
