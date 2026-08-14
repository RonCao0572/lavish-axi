import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../src/chrome-client.js", import.meta.url);

const START = "function escapeHtml(value) {";
const END = "// #endregion chat-markdown";

/**
 * Evaluate only the escaping and Markdown helpers.
 *
 * chrome-client.js touches the DOM at load, so running the whole file would
 * need the fake-browser harness. These helpers are pure, so the test slices the
 * contiguous region they live in and evaluates that instead.
 *
 * @returns {Promise<(value: string) => string>}
 */
async function loadRenderer() {
  const source = await readFile(sourceUrl, "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  assert.ok(start !== -1, "escapeHtml moved; update START in this test");
  assert.ok(end > start, "chat-markdown region moved; update END in this test");

  const context = vm.createContext({});
  vm.runInNewContext(source.slice(start, end), context, { filename: "chat-markdown.js" });
  const render = /** @type {any} */ (context).renderChatMarkdown;
  assert.equal(typeof render, "function", "renderChatMarkdown was not defined by the sliced region");
  return render;
}

test("markup in chat text stays inert", async () => {
  const render = await loadRenderer();
  const html = render('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"), "raw tag reached the output");
  assert.ok(html.includes("&lt;img"), "tag should be escaped and shown literally");
});

test("a javascript: link renders as text with no anchor", async () => {
  const render = await loadRenderer();
  const html = render("[click](javascript:alert(1))");
  assert.ok(!html.includes("<a "), "only http(s) links may become anchors");
  assert.ok(html.includes("click"), "the label should survive as plain text");
});

test("an http link becomes an anchor that cannot reach the opener", async () => {
  const render = await loadRenderer();
  const html = render("[docs](https://example.com/a)");
  assert.ok(html.includes('href="https://example.com/a"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("bold, italic, and inline code render", async () => {
  const render = await loadRenderer();
  const html = render("**bold** and *thin* and `code`");
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>thin</em>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("emphasis inside a code span stays literal", async () => {
  const render = await loadRenderer();
  const html = render("`**not bold**`");
  assert.ok(html.includes("<code>**not bold**</code>"));
  assert.ok(!html.includes("<strong>"));
});

test("a fenced block keeps its contents verbatim", async () => {
  const render = await loadRenderer();
  const html = render("before\n```\nread_file(/x)\n**stet**\n```\nafter");
  assert.ok(html.includes("<pre><code>read_file(/x)\n**stet**</code></pre>"));
  assert.ok(!html.includes("<strong>stet</strong>"));
});

test("bullets become a list", async () => {
  const render = await loadRenderer();
  const html = render("- one\n- two");
  assert.equal(html, "<ul><li>one</li><li>two</li></ul>");
});

test("a quoted line becomes a blockquote even though escaping ran first", async () => {
  const render = await loadRenderer();
  const html = render("> what is the discord gate?");
  assert.equal(html, "<blockquote>what is the discord gate?</blockquote>");
});

test("newlines inside a paragraph survive as line breaks", async () => {
  const render = await loadRenderer();
  const html = render("first\nsecond");
  assert.equal(html, "<p>first<br>second</p>");
});

test("a blank line separates paragraphs", async () => {
  const render = await loadRenderer();
  const html = render("first\n\nsecond");
  assert.equal(html, "<p>first</p><p>second</p>");
});

test("a quote followed by prose keeps the blocks apart", async () => {
  const render = await loadRenderer();
  const html = render("> asked this\nthen answered");
  assert.equal(html, "<blockquote>asked this</blockquote><p>then answered</p>");
});
