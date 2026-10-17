# Abducted! - They appear to be enjoying it (stupid.dcl.eth)

Decentraland SDK7 World for the Knights of Antrom alien collection. A 4x4 parcel (64 m) night field with
a 44 m video dome in the middle: inner and outer surfaces play the "They appear to be enjoying it" music
video on a loop, the Abducted! emote props animate at 2.5x in the centre, and four NPCs in the alien
costumes dance around them (one gets abducted on repeat).

Outside, on the crop circles:

- **NW / NE**: portals to `dungeons.dcl.eth` (Dungeons of Antrom) and `KoA.dcl.eth` (Kingdom of Antrom).
  Walk through the disc or click it; the explorer asks before travelling.
- **SW**: the Antrom Guildstone Ring altar. One ring per wallet, granted through the Rewards dispenser
  used by the Dungeons of Antrom chest drop (see below).
- **SE**: Marketplace kiosk for the Abducted! emotes and the alien costumes.
- A herd of ten cows wanders the field. Click one and the saucer flies over, beams it up and returns it
  later, dropped from the sky somewhere else.
- 24 pylons around the dome and the lights inside follow the music (`AudioAnalysis` on the video; a
  synthetic groove takes over on clients that do not fill it).
- Permanent night (`SkyboxTime` 01:00).

Video: `https://storage.googleapis.com/koa-db-media/alien-dome/enjoying-720p.mp4` (720p30, ~90 MB, GCS
bucket `koa-db-media` on the `koa-db` Firebase project, public, CORS enabled).

## Commands

```bash
npm install
npm run build:models # regenerate models/dome.glb, plaza.glb, portal.glb from tools/
npm run build        # type-check and bundle bin/index.js
npm run start        # preview + local authoritative server. Use the desktop Explorer: the legacy web
                     # preview cannot render GltfNodeModifiers (dome stays grey), does not load the
                     # costume wearables on NPCs and does not talk to the authoritative server.
npm run deploy -- --target-content https://worlds-content-server.decentraland.org   # publish the World
npm run server-logs  # tail the World server logs (wallet in scene.json logsPermissions)
```

## Ring claim: server configuration

The claim runs on the World's authoritative server (`src/server/ringServer.ts`). The server reads the
Rewards key from the World env store; nothing secret is in the scene bundle. Set it once from this folder
(wallet signature required):

```bash
npx sdk-commands storage env set REWARDS_KEY_GIFT --value <dispenser key>
# only if the key is a campaign master key instead of a dispenser key:
npx sdk-commands storage env set REWARDS_GIFT_TARGET --value 0xea44daaaa7f259bd2c00b3a5c6b01b482c561881
npx sdk-commands storage env set REWARDS_GIFT_VALUE --value 0
```

Claims are recorded per wallet in player storage (`guildstoneRing`). Guests are refused. For local
testing put the variables in a `.env` file (git-ignored).

## Layout

- `src/index.ts`: entry; asks the runtime whether it is the server and branches.
- `src/layout.ts`: plot constants, formation centres, URLs and URNs.
- `src/shared/messages.ts`: `ringHello` / `ringClaim` (client to server), `ringStatus` (server to one client).
- `src/server/ringServer.ts`: Rewards request, per-wallet record, replies.
- `src/client/dome.ts`: VideoPlayer, dome + `GltfNodeModifiers` video material, diorama, hero cow, interior lights.
- `src/client/music.ts`: smoothed `AudioAnalysis` levels with a fallback groove.
- `src/client/plaza.ts`: night sky, ground, rim pylons, portals, kiosk, decor.
- `src/client/cows.ts`: herd wander + saucer abduction.
- `src/client/aliens.ts`: costume NPCs and emote cycling.
- `src/client/ring.ts`, `src/client/ui.tsx`: altar, claim flow, toast.
- `tools/glb.mjs`: tiny binary glTF writer shared by the generators.
- `tools/build-dome.mjs`: `models/dome.glb` (nodes `DomeInner`, `DomeOuter`, `DoorFrame`, `Floor`).
  Radius 22 m, 6 m wall + hemispherical cap (apex 28 m), 5.7 m x 4 m south door. UVs wrap the video twice
  around and from floor to apex.
- `tools/build-plaza.mjs`: `models/plaza.glb` (ground, flattened crop, glow rings, path).
- `tools/build-portal.mjs`: `models/portal.glb` (plinth, ring, translucent disc).
- `models/abducted_props.glb`: props export from the Abducted! emote (clip `Abducted_Prop`, 8 s).
- `models/cow.glb`, `ufo.glb`, `pumpkin.glb`, `grave.glb`: props isolated from the emote source
  (headless Blender, by vertex group). `models/ring.glb`: the Guildstone Ring mesh from the wearable.

## Re-encoding the video

```bash
ffmpeg -i "They appear to be enjoying it - music video.mp4" -vf "scale=1280:720,fps=30" \
  -c:v libx264 -preset medium -crf 24 -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart \
  enjoying-720p.mp4
```

Upload to `koa-db-media/alien-dome/` with the Firebase admin service account and make the object public.
