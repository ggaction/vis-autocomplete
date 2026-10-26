# Link previews

`index.html` contains the public Open Graph and large-image Twitter/X metadata. Keep it in the initial HTML head: link crawlers should not need JavaScript, a session, or access to a saved visualization. The canonical URL is `https://vis.autocomplete.studio/`.

The 1200 × 630 artwork lives in `web/social/link-preview.svg`. It uses the app's icon and group colors with illustrative charts, never a user's dataset. Run `node scripts/build-social-preview.js` after editing it and commit the generated `web/social/link-preview-v2.png` as a required runtime asset. The production build copies `web/social/`. For a subsequent image change, use a fresh image filename and update both image meta tags to avoid stale image caches.

Verify with `npm run build` and `node --test test/cloud-server.test.js`. This checks the built HTML and PNG over HTTP as an unauthenticated crawler. It does not send a KakaoTalk message or confirm Kakao's live cache.

Include these changes in the next user-authorized release; ordinary pushes do not deploy. After that release, use Kakao's [URL metadata tool](https://developers.kakao.com/docs/en/tool/common) to check the live preview and reset cached metadata if an old preview persists.

Metadata references: [Open Graph protocol](https://ogp.me/), [Kakao's scrap metadata](https://developers.kakao.com/docs/ko/message-template/common).
