// 极简 API 封装：JSON 序列化、错误归一、401/封禁全局事件。

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (body instanceof FormData) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError('网络请求失败，请检查连接', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应（理论上不会出现在本应用的 API 中）
  }

  if (!res.ok) {
    if (res.status === 401) {
      document.dispatchEvent(new CustomEvent('fm:unauthorized'));
    }
    if (res.status === 403 && data?.code === 'banned') {
      document.dispatchEvent(new CustomEvent('fm:banned', { detail: data.error }));
    }
    throw new ApiError(data?.error || '请求失败（' + res.status + '）', res.status, data?.code);
  }
  return data;
}
