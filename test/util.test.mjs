import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, today, newBoard, boardName } from '../public/util.js';
import { summarize } from '../public/store.js';

test('boards are dated YYYY-MM-DD in local time', () => {
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  const b = newBoard(new Date(2026, 9, 21));
  assert.equal(b.date, '2026-10-21');
  assert.equal(boardName(b), '2026-10-21');
  assert.equal(boardName({ ...b, title: 'Kitchen' }), 'Kitchen');
  assert.deepEqual(b.items, []);
});

test('classify: links, images, video, embeds, colours, text', () => {
  assert.deepEqual(classify('https://youtu.be/dQw4w9WgXcQ'), { type: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(classify('https://www.youtube.com/watch?v=abc123&t=4').videoId, 'abc123');
  assert.equal(classify('https://youtube.com/shorts/xyz_9').videoId, 'xyz_9');
  assert.equal(classify('https://vimeo.com/76979871').videoId, '76979871');
  assert.equal(classify('https://cdn.example.com/a/photo.JPG?w=800').type, 'image');
  assert.equal(classify('https://example.com/clip.mp4').type, 'video');
  assert.deepEqual(classify('https://www.are.na/block/123'), { type: 'link', url: 'https://www.are.na/block/123', site: 'are.na' });
  assert.deepEqual(classify('#C46A4A'), { type: 'color', hex: '#c46a4a' });
  assert.equal(classify('quiet, warm, linen').type, 'text');
  assert.equal(classify('javascript:alert(1)').type, 'text');
  assert.equal(classify('   '), null);
});

test('summaries pick up to four covers', () => {
  const s = summarize({
    id: 'b', date: '2026-10-21', updatedAt: 'x',
    items: [
      { type: 'text', text: 'hi' },
      { type: 'image', src: 'media/1.webp' },
      { type: 'embed', provider: 'youtube', videoId: 'v' },
      { type: 'link', url: 'u', image: 'https://x/og.png' },
      { type: 'image', src: 'media/2.webp' },
      { type: 'image', src: 'media/3.webp' },
    ],
  });
  assert.equal(s.count, 6);
  assert.deepEqual(s.covers, ['media/1.webp', 'https://i.ytimg.com/vi/v/hqdefault.jpg', 'https://x/og.png', 'media/2.webp']);
});
