import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotesInk, validateNotesInk, remapStrokes } from '../public/notes-ink-model.js';

const stroke = a => ({ tool:'b', width:2.4, pressure:true, points:[{a,x:0,y:1,p:.6},{a,x:1,y:1,p:.6}] });
test('private annotation schema bounds and allowlist',()=>{
  const value={v:1,pages:{0:{text:'Private script',strokes:[{...stroke(2),unexpected:'discard'}]}}};
  const valid=validateNotesInk(value,['Private script']);
  assert.equal(valid.pages[0].strokes[0].tool,'b');
  assert(!('unexpected' in valid.pages[0].strokes[0]));
  assert.deepEqual(validateNotesInk(undefined,['']),emptyNotesInk());
  assert.throws(()=>validateNotesInk(value,['Different text']));
  assert.throws(()=>validateNotesInk({...value,pages:{2:value.pages[0]}},['Private script']));
  assert.throws(()=>validateNotesInk({v:1,pages:{0:{text:'abc',strokes:[stroke(9)]}}},['abc']));
  for(const field of ['x','y','p']) {
    const invalid=structuredClone(value);invalid.pages[0].strokes[0].points[0][field]=Infinity;
    assert.throws(()=>validateNotesInk(invalid,['Private script']));
  }
});
test('marks follow unchanged text and do not stay on replaced words',()=>{
  assert.equal(remapStrokes([stroke(6)],'Hello world','New Hello world')[0].points[0].a,10);
  assert.equal(remapStrokes([stroke(6)],'Hello world','Hello friend').length,0);
  assert.equal(remapStrokes([stroke(0)],'Hello world','Hello friend')[0].points[0].a,0);
  assert.equal(remapStrokes([stroke(6)],'Hello world','world')[0].points[0].a,0);
});
