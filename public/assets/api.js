// 极简 API 封装：JSON 序列化、错误归一、401/封禁全局事件。
// 支持 FormData 上传进度回调（通过 XHR）；其余走 fetch。

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, onProgress } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };

  if (body !== undefined) {
    if (body instanceof FormData) {
      if (onProgress) {
        return xhrUpload(path, body, onProgress);
      }
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

  return parseResponse(res);
}

function xhrUpload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const res = new Response(xhr.responseText, { status: xhr.status, headers: xhr.getAllResponseHeaders() });
        resolve(parseResponse(res));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new ApiError('网络请求失败，请检查连接', 0));
    xhr.send(form);
  });
}

async function parseResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应
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