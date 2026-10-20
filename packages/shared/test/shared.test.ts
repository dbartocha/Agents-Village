import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalTool, parseAgentKind, parseHookPayload, projectName, relPath, stationForTool, summarizeTool } from '../src/index.ts';

test('tools map to stations', () => {
  assert.equal(stationForTool('Read'), 'lib');
  assert.equal(stationForTool('Write'), 'site');
  assert.equal(stationForTool('Bash'), 'forge');
  assert.equal(stationForTool('WebSearch'), 'tower');
  assert.equal(stationForTool('TodoWrite'), 'plaza');
});

test('GitHub Copilot tools map to the same stations', () => {
  assert.equal(stationForTool('view'), 'lib');
  assert.equal(stationForTool('edit'), 'site');
  assert.equal(stationForTool('powershell'), 'forge');
  assert.equal(stationForTool('run_in_terminal'), 'forge');
  assert.equal(stationForTool('fetch_webpage'), 'tower');
  assert.equal(canonicalTool('create_file'), 'Write');
  assert.equal(summarizeTool('read_file', { filePath: 'C:\\dev\\shop\\a.ts' }, 'C:\\dev\\shop'), 'a.ts');
  assert.equal(parseAgentKind('Copilot'), 'copilot');
  assert.equal(parseAgentKind('other'), 'claude');
});

test('paths are shown relative to the project on Windows and POSIX', () => {
  assert.equal(relPath('C:\\dev\\shop\\src\\a.ts', 'C:\\dev\\shop'), 'src/a.ts');
  assert.equal(relPath('/home/me/shop/src/a.ts', '/home/me/shop/'), 'src/a.ts');
  assert.equal(relPath('/etc/hosts', '/home/me/shop'), '/etc/hosts');
  assert.equal(projectName('C:\\dev\\shop\\'), 'shop');
});

test('tool inputs become one short line', () => {
  assert.equal(summarizeTool('Bash', { command: 'npm   test\n-- --watch' }), 'npm test -- --watch');
  assert.equal(summarizeTool('Grep', { pattern: 'TODO', path: '/p/src' }, '/p'), 'TODO · src');
  assert.equal(summarizeTool('AskUserQuestion', { questions: [{ question: 'Which DB?' }] }), 'Which DB?');
  assert.equal(summarizeTool('mcp__x__y', { title: 'Hello' }), 'Hello');
  assert.ok(summarizeTool('Bash', { command: 'x'.repeat(500) }).length <= 90);
});

test('hook payload validation is strict about the basics only', () => {
  assert.equal(parseHookPayload(null).ok, false);
  assert.equal(parseHookPayload({ session_id: 'a' }).ok, false);
  assert.equal(parseHookPayload({ hook_event_name: 'Stop', session_id: 'a', extra: 1 }).ok, true);
});
