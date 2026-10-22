# ConvertKB

Compress images and PDFs to an exact KB, set DPI and resize to exact pixels / cm. 100% in-browser.
Built with Astro, deployed to Cloudflare Workers.

## Run it

```bash
npm install
npm run validate   # data + internal-link checks (no install needed beyond Node 22)
npm run dev        # http://localhost:4321
npm run build && npm run preview
npm run deploy     # wrangler deploy
```

## How the site is organised

| What | Where |
| --- | --- |
| Every tool page, menu, hub page, sitemap entry and search result | `src/data/tools-*.ts` (one object per page) |
| Site name, e-mail, AdSense id, Search Console + Analytics ids | `src/data/site.ts` |
| Page template for all tools | `src/pages/[slug].astro` |
| Menu (desktop mega-menu + mobile drawer) | `src/components/Header.astro` (built from the data) |
| Design system | `src/styles/global.css` |
| Compression engine (image, PDF, calculators) | `public/js/tool.js` |
| Guides (blog) | `src/content/blog/*.md` |
| Legal pages | `src/pages/{about-us,contact-us,privacy-policy,terms-of-service}.astro` |

### Add a new tool page
Add an object to one of the arrays in `src/data/tools-*.ts` (copy a neighbour), run `npm run validate`. The page, menu entry, hub listing, search result, sitemap URL, breadcrumbs and FAQ/structured data are generated automatically.

## Before you go live
1. Replace `email` in `src/data/site.ts` with a mailbox you really own (the Contact, About and Privacy pages use it).
2. Verify the exam/ID presets in `tools-exams.ts` against current official notifications. They are typical starting values.
3. Submit `https://convertkb.com/sitemap-index.xml` in Google Search Console and paste the verification code into `googleSiteVerification`.

## AdSense
1. Deploy, let Google index the site, and apply at adsense.google.com with the domain.
2. After approval put your publisher id in `site.ts` → `adsense.client` and add the matching line to `public/ads.txt`.
3. Optional: create ad units and fill `adsense.slots` (`top`, `mid`, `bottom`). Leave empty to use Auto ads only.
4. For visitors in the EEA / UK / Switzerland, enable Google's free consent message (AdSense → Privacy & messaging). The Privacy Policy already describes it.
