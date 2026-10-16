# Abducted! Dome (57,-111)

Decentraland SDK7 scene for the Knights of Antrom alien collection. A closed dome whose inner and outer
surfaces play the "They appear to be enjoying it" music video on a loop, with the Abducted! emote props
(UFO, beam, cow, pumpkin, grave) animating in the centre and the cow waiting by the door.

- Parcel: `57,-111` (door faces south, toward the road at `57,-112`).
- Video: `https://storage.googleapis.com/koa-db-media/alien-dome/enjoying-720p.mp4` (720p30, ~90 MB, GCS
  bucket `koa-db-media` on the `koa-db` Firebase project, public, CORS enabled).
- Clicking the cow opens the Abducted! emote collection; clicking the diorama opens the alien costume
  collection.

## Commands

```bash
npm install
npm run build:dome   # regenerate models/dome.glb from tools/build-dome.mjs
npm run build        # type-check and bundle bin/index.js
npm run start        # preview (use the desktop Explorer; the legacy web preview cannot render
                     # GltfNodeModifiers, so the dome walls stay dark there)
npm run deploy       # publish to 57,-111 (wallet signature required)
```

## Layout

- `src/index.ts`: scene entry. VideoPlayer, dome + `GltfNodeModifiers` video material, Animator loop,
  hero cow, lights.
- `tools/build-dome.mjs`: writes `models/dome.glb` (nodes `DomeInner`, `DomeOuter`, `DoorFrame`,
  `Floor`). Radius 7.7 m, 5 m wall + hemispherical cap (apex 12.7 m), 3 m x 3 m south door. UVs wrap
  the video twice around and from floor to apex.
- `models/abducted_props.glb`: props export from the Abducted! emote (clip `Abducted_Prop`, 8 s).
- `models/cow.glb`: the cow isolated from the emote props atlas.

## Re-encoding the video

```bash
ffmpeg -i "They appear to be enjoying it - music video.mp4" -vf "scale=1280:720,fps=30" \
  -c:v libx264 -preset medium -crf 24 -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart \
  enjoying-720p.mp4
```

Upload to `koa-db-media/alien-dome/` with the Firebase admin service account and make the object public.
