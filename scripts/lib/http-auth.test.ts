import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerAuth } from './http-auth';

// Minimal Express req/res doubles — enough to exercise the middleware.
function makeReq(authorization?: string) {
  return { headers: authorization === undefined ? {} : { authorization } } as any;
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res;
}

test('bearerAuth: calls next() when the token matches', () => {
  const mw = bearerAuth('s3cret-token');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq('Bearer s3cret-token'), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('bearerAuth: 401 when the token is wrong', () => {
  const mw = bearerAuth('s3cret-token');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq('Bearer wrong-token'), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as any).error.message, 'Unauthorized');
});

test('bearerAuth: 401 when the Authorization header is missing', () => {
  const mw = bearerAuth('s3cret-token');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq(), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('bearerAuth: 401 when the scheme is not Bearer', () => {
  const mw = bearerAuth('s3cret-token');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq('Basic s3cret-token'), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('bearerAuth: a token that is a prefix of the real one is rejected', () => {
  const mw = bearerAuth('s3cret-token');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq('Bearer s3cret'), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
