import assert from 'node:assert/strict';
import {lineDiff,diffSummary} from '../frontend/src/diff.js';
const ADD = '+';
const DEL = '-';
const SAME = ' ';
const joinOld=ops=>ops.filter(o=>o.type !== ADD).map(o=>o.text).join('\n');
const joinNew=ops=>ops.filter(o=>o.type !== DEL).map(o=>o.text).join('\n');
const types=ops=>ops.map(o=>o.type+o.text).join('|');
const op=(type,text)=>({type,text});

// Equal texts keep every line as context and report no changes.
assert.equal(types(lineDiff('one\ntwo\nthree','one\ntwo\nthree')), ' one| two| three','Equal texts are pure context');
assert.deepEqual(diffSummary(lineDiff('one\ntwo\nthree','one\ntwo\nthree')),{added:0,removed:0});
assert.deepEqual(lineDiff('',''),[],'Two empty texts have no operations');
assert.deepEqual(lineDiff('same\n','same\n'),[op(SAME,'same'),op(SAME,'')],'Trailing newline is a kept empty line');

// Pure additions keep old lines and insert new ones.
const addedOps=lineDiff('alpha\nomega','alpha\nbeta\nomega');
assert.equal(types(addedOps), ' alpha' + '|' + ADD + 'beta' + '| omega');
assert.deepEqual(diffSummary(addedOps),{added:1,removed:0});
assert.deepEqual(diffSummary(lineDiff('','fresh line')),{added:1,removed:0},'Writing an empty file from scratch is pure addition');

// Pure removals drop only the deleted lines.
const removedOps=lineDiff('alpha\nbeta\nomega','alpha\nomega');
assert.equal(types(removedOps), ' alpha' + '|' + DEL + 'beta' + '| omega');
assert.deepEqual(diffSummary(removedOps),{added:0,removed:1});
assert.deepEqual(diffSummary(lineDiff('last line','')),{added:0,removed:1},'Deleting every line is pure removal');

// A change in the middle keeps surrounding context on both sides.
const middleOps=lineDiff('h1\nold\nh2\nh3','h1\nnew\nh2\nh3');
assert.equal(types(middleOps), ' h1' + '|' + DEL + 'old' + '|' + ADD + 'new' + '| h2| h3','Changed lines pair with their context');
assert.equal(joinOld(middleOps),'h1\nold\nh2\nh3');assert.equal(joinNew(middleOps),'h1\nnew\nh2\nh3');
assert.deepEqual(diffSummary(middleOps),{added:1,removed:1});

// Multi-line rewrites stay exact reconstructions of both inputs.
const rewrite=lineDiff('a\nb\nc\nd\ne','a\nx\ny\nz\ne');
assert.equal(joinOld(rewrite),'a\nb\nc\nd\ne');assert.equal(joinNew(rewrite),'a\nx\ny\nz\ne');
assert.deepEqual(diffSummary(rewrite),{added:3,removed:3});

// CRLF files: carriage returns are content and never leak into the next line.
const crlf=lineDiff('first\r\nsecond\r\nthird','first\r\nsecond changed\r\nthird');
assert.equal(joinOld(crlf),'first\r\nsecond\r\nthird');assert.equal(joinNew(crlf),'first\r\nsecond changed\r\nthird');
assert.deepEqual(lineDiff('a\r\nb','a\r\nb'),[op(SAME,'a\r'),op(SAME,'b')],'Identical CRLF text is pure context');

// Random rebuild invariant: ops always reconstruct both texts.
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
for(let round=0;round<40;round++){
 const gen=n=>Array.from({length:n},()=>'line'+Math.floor(rnd()*6)).join('\n');
 const oldText=gen(Math.floor(rnd()*30)),newText=gen(Math.floor(rnd()*30)),ops=lineDiff(oldText,newText);
 assert.equal(joinOld(ops),oldText,'Round '+round+' reconstructs the old text');
 assert.equal(joinNew(ops),newText,'Round '+round+' reconstructs the new text');
 const summary=diffSummary(ops);
 assert.equal(ops.filter(o=>o.type===ADD).length,summary.added);
 assert.equal(ops.filter(o=>o.type===DEL).length,summary.removed);
}

// Oversized inputs fall back to a whole replace instead of the LCS table.
const bigOld=Array.from({length:2500},(_,i)=>'old'+i).join('\n');
const bigNew=Array.from({length:2500},(_,i)=>'new'+i).join('\n');
const fallback=lineDiff(bigOld,bigNew);
assert.equal(fallback.length,5000);
assert.ok(fallback.slice(0,2500).every(o=>o.type===DEL),'Fallback removes every old line first');
assert.ok(fallback.slice(2500).every(o=>o.type===ADD),'Fallback adds every new line after');
assert.deepEqual(diffSummary(fallback),{added:2500,removed:2500});
assert.equal(joinOld(fallback),bigOld);assert.equal(joinNew(fallback),bigNew);

// Within the budget, the same volume still diffs with context.
const kept=lineDiff('base\nx\nmid','base\ny\nmid');
assert.equal(types(kept), ' base' + '|' + DEL + 'x' + '|' + ADD + 'y' + '| mid');
const atLimit=lineDiff(Array.from({length:2000},(_,i)=>'l'+i).join('\n'),Array.from({length:2000},(_,i)=>i===999?'changed':'l'+i).join('\n'));
assert.deepEqual(diffSummary(atLimit),{added:1,removed:1},'4000 total lines still use the real diff');

console.log('PASS: equal/add/remove/middle edits, CRLF content, reconstruction invariant, large-input fallback, summary counts.');
