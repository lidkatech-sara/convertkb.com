// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	site: "https://convertkb.com",
	trailingSlash: "always",
	integrations: [mdx(), sitemap({ filter: (page) => !page.includes("/404") })],
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
	}),
});
