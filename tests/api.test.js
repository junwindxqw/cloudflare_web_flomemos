import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../public/assets/api.js';

// 假 XHR：send() 后由测试手动触发回调，模拟服务器响应
let lastXhr;
class FakeXhr {
  constructor() {
    this.upload = {};
    this.status = 0;
    this.responseText = '';
    this.rawHeaders = '';
    lastXhr = this;
  }
  open() {}
  send() {}
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
}

describe('api xhrUpload', () => {
  beforeEach(() => {
    global.XMLHttpRequest = FakeXhr;
  });
  afterEach(() => {
    delete global.XMLHttpRequest;
  });

  function form() {
    return new FormData();
  }

  it('带 onProgress 时走 XHR 并解析成功响应（回归：getAllResponseHeaders 是原始字符串，不能直接传给 Response）', async () => {
    const promise = api('/api/upload', {
      method: 'POST',
      body: form(),
      onProgress: () => {},
    });
    const ratios = [];
    lastXhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    lastXhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    lastXhr.status = 200;
    lastXhr.responseText = '{"url":"/files/abc.png","key":"abc.png"}';
    lastXhr.rawHeaders = 'content-type: application/json; charset=utf-8\r\ncache-control: no-store';
    lastXhr.onload();
    await expect(promise).resolves.toEqual({ url: '/files/abc.png', key: 'abc.png' });
  });

  it('非 2xx 响应抛出带状态码的 ApiError', async () => {
    const promise = api('/api/upload', {
      method: 'POST',
      body: form(),
      onProgress: () => {},
    });
    lastXhr.status = 400;
    lastXhr.responseText = '{"error":"仅支持 png / jpg 格式"}';
    lastXhr.rawHeaders = 'content-type: application/json; charset=utf-8';
    lastXhr.onload();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('仅支持 png / jpg 格式');
  });

  it('status 0（中断/网络失败）给出友好错误而非构造异常', async () => {
    const promise = api('/api/upload', {
      method: 'POST',
      body: form(),
      onProgress: () => {},
    });
    lastXhr.status = 0;
    lastXhr.responseText = '';
    lastXhr.onload();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it('onabort 时 promise 以网络错误拒绝', async () => {
    const promise = api('/api/upload', {
      method: 'POST',
      body: form(),
      onProgress: () => {},
    });
    lastXhr.onabort();
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });
});
