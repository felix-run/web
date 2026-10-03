// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetPreview, assetDataUrl } from '../src/components/skills/asset-preview';
import { SkillMarkdown } from '../src/components/skills/skill-markdown';

/**
 * Skill content is agent-written, and the library is where a person reads it
 * before deciding whether every future run should. These pin what may reach
 * the DOM from it: no element from raw HTML, no request for a remote image, no
 * link with a script scheme, and a `data:` URL only for an allowlisted raster
 * type — never SVG, which an `<img>` still parses as markup.
 */

afterEach(cleanup);

const PNG = 'iVBORw0KGgo=';

describe('SkillMarkdown', () => {
  it('renders markdown, and drops raw HTML instead of building it', async () => {
    render(
      <SkillMarkdown
        markdown={
          '# Title\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n<b>bold</b>'
        }
      />,
    );
    expect(await screen.findByText('Title')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('does not load a remote image, and names it instead', async () => {
    render(<SkillMarkdown markdown={'![pixel](https://tracker.test/p.gif)'} />);
    expect(await screen.findByText(/\[image: https:\/\/tracker\.test\/p\.gif\]/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('draws a bundle image through an allowlisted data URL, and not an SVG one', async () => {
    render(
      <SkillMarkdown
        markdown={'![logo](assets/logo.png)\n\n![vector](assets/v.svg)'}
        files={{ 'assets/logo.png': PNG, 'assets/v.svg': '<svg onload="alert(1)"/>' }}
      />,
    );
    const img = await screen.findByAltText('logo');
    expect(img.getAttribute('src')).toBe(`data:image/png;base64,${PNG}`);
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText(/\[image: assets\/v\.svg\]/)).toBeTruthy();
  });

  it('opens bundle links in place and keeps a script scheme from becoming a link', async () => {
    render(
      <SkillMarkdown
        markdown={'[api](references/api.md) [x](javascript:alert(1)) [site](https://example.test)'}
        files={{ 'references/api.md': '# API' }}
        onOpenFile={() => {}}
      />,
    );
    expect(await screen.findByRole('button', { name: 'api' })).toBeTruthy();
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.startsWith('javascript:'))).toBe(false);
    const site = screen.getByRole('link', { name: 'site' });
    expect(site.getAttribute('rel')).toContain('noreferrer');
  });
});

describe('asset data URLs', () => {
  it('builds one only for an allowlisted raster type with well-formed base64', () => {
    expect(assetDataUrl('assets/a.png', PNG)).toBe(`data:image/png;base64,${PNG}`);
    expect(assetDataUrl('assets/a.svg', PNG)).toBeNull();
    expect(assetDataUrl('assets/a.html', PNG)).toBeNull();
    expect(assetDataUrl('assets/a.pdf', PNG)).toBeNull();
    expect(assetDataUrl('assets/a.png', 'not base64!')).toBeNull();
  });

  it('refuses when the harness and the path disagree about the type', () => {
    expect(assetDataUrl('assets/a.png', PNG, 'image/png')).not.toBeNull();
    expect(assetDataUrl('assets/a.png', PNG, 'image/svg+xml')).toBeNull();
  });

  it('shows a non-image asset as a file card, saying why there is no preview', () => {
    render(<AssetPreview path="assets/manual.pdf" base64Content={PNG} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/only raster images are shown/)).toBeTruthy();
  });
});
