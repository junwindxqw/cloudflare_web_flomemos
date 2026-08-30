// 提取正文中的 #标签。
// 规则与 flomo 一致：# 需出现在行首或空白字符之后，避免把 URL 的 #锚点、Markdown 标题（# 后跟空格）误判为标签；
// 标签字符：Unicode 字母/数字（兼容中文）、下划线、中划线、斜杠（支持 #工作/项目 嵌套标签）。
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gmu;

export function extractTags(content) {
  const tags = new Set();
  for (const match of content.matchAll(TAG_RE)) {
    const tag = match[1];
    if (tag.length > 0 && tag.length <= 64) tags.add(tag);
  }
  return [...tags];
}
