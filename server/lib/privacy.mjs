// External tool/provider diagnostics can echo complete prompts or credentials.
// Only application-authored messages may cross into logs, history, or UI errors.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function writePrivateFile(file, data) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, '.private-' + randomBytes(12).toString('hex'));
  try {
    fs.writeFileSync(temporary, data, {mode:0o600, flag:'wx'});
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, {force:true}); }
}
export function privateError(message) {
  const error = new Error(message);
  error.safeToDisplay = true;
  return error;
}
export function publicAgentError(error, fallback = 'Agent request failed. Check the selected agent, provider and permissions.') {
  return error?.safeToDisplay === true ? error.message : fallback;
}
