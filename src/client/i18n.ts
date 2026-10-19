import { engine, PointerEvents, TextShape } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

/**
 * UI language, following the player's choice in the Antrom AFK wearable. The wearable stores it on
 * the AFK profile (Firebase: players/afk_v1_{wallet}.settings.language, one of en/fr/es/zh) and
 * falls back to the KoA profile's selectedLanguage. We read the same documents, unsigned.
 *
 * t(english, ...args) looks the English source text up in ROWS and returns the current column,
 * substituting {0}, {1}... Unknown strings come back unchanged, so English is always safe.
 */

export type Language = 'en' | 'fr' | 'es' | 'zh'
const COLUMN: Record<Language, number> = { en: 0, fr: 1, es: 2, zh: 3 }
const isLanguage = (v: unknown): v is Language => v === 'en' || v === 'fr' || v === 'es' || v === 'zh'
const KOA_LANGUAGE: Record<string, Language> = { English: 'en', French: 'fr', Spanish: 'es', Chinese: 'zh' }
const BACKEND_URL = 'https://dcl-firebase-backend.vercel.app'

let current: Language = 'en'
const listeners: (() => void)[] = []

export const getLanguage = () => current

export function setLanguage(lang: Language) {
  if (lang === current) return
  current = lang
  retranslateWorld()
  for (const f of listeners) f()
}

/** Run now and again whenever the language changes, for anything built from strings once. */
export function onLanguage(f: () => void) {
  listeners.push(f)
  f()
}

/** Every string t() has produced, back to its source: lets the world pass re-translate texts set once. */
const SOURCE = new Map<string, { key: string; args: (string | number)[] }>()

export function t(text: string, ...args: (string | number)[]): string {
  const row = MAP.get(text)
  let out = (row && row[COLUMN[current]]) || text
  for (let i = 0; i < args.length; i++) out = out.split(`{${i}}`).join(String(args[i]))
  if (row && out !== text) SOURCE.set(out, { key: text, args })
  return out
}

/** Re-translate a string that was produced by t() earlier (or is a plain dictionary key). */
function again(text: string): string {
  const src = SOURCE.get(text)
  if (src) return t(src.key, ...src.args)
  return MAP.has(text) ? t(text) : text
}

/** 3D labels and hover texts are written at creation; rewrite the ones we know when the language changes. */
function retranslateWorld() {
  for (const [entity, shape] of engine.getEntitiesWith(TextShape)) {
    const next = again(shape.text)
    if (next !== shape.text) TextShape.getMutable(entity).text = next
  }
  for (const [entity, pe] of engine.getEntitiesWith(PointerEvents)) {
    if (!pe.pointerEvents.some((p) => p.eventInfo?.hoverText && again(p.eventInfo.hoverText) !== p.eventInfo.hoverText)) continue
    for (const p of PointerEvents.getMutable(entity).pointerEvents) if (p.eventInfo?.hoverText) p.eventInfo.hoverText = again(p.eventInfo.hoverText)
  }
}

/**
 * Pick up the player's wallet once the explorer provides it, then read the wearable's setting and
 * keep re-reading it: the wearable has no channel into the scene, so a change made in the ring
 * shows up here on the next poll. Fast for the first minute, then relaxed.
 */
const POLL_FAST = 3
const POLL_SLOW = 15
const FAST_FOR = 60

export function initLanguage() {
  let tries = 0
  let wallet = ''
  let elapsed = 0
  let nextPoll = 0
  let busy = false
  engine.addSystem(function languageProbe(dt) {
    if (!wallet) {
      const id = getPlayer()?.userId
      if (!id || !/^0x[a-fA-F0-9]{40}$/.test(id)) {
        if (++tries > 600) engine.removeSystem(languageProbe) // ~10 s at 60 fps: a guest or no identity
        return
      }
      wallet = id.toLowerCase()
    }
    elapsed += dt
    if (busy || elapsed < nextPoll) return
    nextPoll = elapsed + (elapsed < FAST_FOR ? POLL_FAST : POLL_SLOW)
    busy = true
    void load(wallet).finally(() => (busy = false))
  })
}

async function load(wallet: string) {
  try {
    const afk = await fetch(`${BACKEND_URL}/player/afk_v1_${wallet}`)
    if (afk.ok) {
      const doc = (await afk.json()) as { settings?: { language?: unknown } }
      if (isLanguage(doc?.settings?.language)) return setLanguage(doc.settings.language)
    }
    const koa = await fetch(`${BACKEND_URL}/player/${wallet}`)
    if (koa.ok) {
      const doc = (await koa.json()) as { selectedLanguage?: unknown }
      const code = typeof doc?.selectedLanguage === 'string' ? KOA_LANGUAGE[doc.selectedLanguage] : undefined
      if (code) setLanguage(code)
    }
  } catch (e) {
    console.log('[i18n] language lookup failed', e instanceof Error ? e.message : String(e))
  }
}

// [English, Français, Español, 中文]
const ROWS: ReadonlyArray<readonly [string, string, string, string]> = [
  // --- game HUD ---
  ['PRACTICE', 'ENTRAÎNEMENT', 'PRÁCTICA', '练习'],
  ['SCORE  {0}', 'SCORE  {0}', 'PUNTOS  {0}', '得分  {0}'],
  ['COWS  {0}', 'VACHES  {0}', 'VACAS  {0}', '奶牛  {0}'],
  ['WASD to fly  ·  look at a cow, click or E to drop the beam', 'ZQSD pour voler  ·  visez une vache, clic ou E pour lancer le rayon', 'WASD para volar  ·  mira una vaca, clic o E para lanzar el rayo', 'WASD 飞行  ·  瞄准奶牛，点击或按 E 放下光束'],
  ['LEAVE GAME', 'QUITTER', 'SALIR DEL JUEGO', '离开游戏'],
  ['EDGE OF THE PASTURE', 'BORD DU PÂTURAGE', 'BORDE DEL PRADO', '牧场边缘'],
  ['BEAM READY', 'RAYON PRÊT', 'RAYO LISTO', '光束就绪'],
  ['CHARGING...', 'CHARGE...', 'CARGANDO...', '充能中...'],
  ['BEAM ACTIVE', 'RAYON ACTIF', 'RAYO ACTIVO', '光束启动'],
  ['COOLDOWN', 'RECHARGE', 'ENFRIAMIENTO', '冷却中'],
  ['GOT ONE!', 'ATTRAPÉE !', '¡UNA MÁS!', '抓到了！'],
  ['the real round starts in a moment', 'la vraie manche commence dans un instant', 'la ronda real empieza en un momento', '正式回合即将开始'],
  [
    'no clock yet: fly over to the cow, look at it, click or E to drop the beam\nthe beam needs a moment to grab, so lead the cow a little',
    "pas de chrono : volez jusqu'à la vache, visez-la, clic ou E pour lancer le rayon\nle rayon met un instant à saisir, visez un peu devant la vache",
    'sin reloj aún: vuela hasta la vaca, mírala, clic o E para lanzar el rayo\nel rayo tarda un momento en agarrar, apunta un poco por delante',
    '尚未计时：飞到奶牛上方，瞄准它，点击或按 E 放下光束\n光束需要片刻才能抓住，请稍微提前瞄准'
  ],
  ['SKIP PRACTICE  (F)', "PASSER L'ENTRAÎNEMENT  (F)", 'SALTAR PRÁCTICA  (F)', '跳过练习  (F)'],
  ['3 minutes · catch as many cows as you can', '3 minutes · attrapez le plus de vaches possible', '3 minutos · atrapa todas las vacas que puedas', '3 分钟 · 尽可能多地抓奶牛'],
  ['TIME!', 'TEMPS !', '¡TIEMPO!', '时间到！'],
  ['ROUND OVER', 'MANCHE TERMINÉE', 'RONDA TERMINADA', '回合结束'],
  ['NEW BEST THIS SESSION', 'NOUVEAU RECORD DE LA SESSION', 'NUEVO RÉCORD DE LA SESIÓN', '本次最佳成绩'],
  ['best this session  {0}', 'record de la session  {0}', 'mejor de la sesión  {0}', '本次最佳  {0}'],
  ['COWS', 'VACHES', 'VACAS', '奶牛'],
  ['DROPS', 'TIRS', 'LANZAMIENTOS', '投放'],
  ['CATCHES', 'PRISES', 'CAPTURAS', '抓获'],
  ['ACCURACY', 'PRÉCISION', 'PRECISIÓN', '命中率'],
  ['PLAY AGAIN  (E)', 'REJOUER  (E)', 'JUGAR OTRA VEZ  (E)', '再玩一次  (E)'],
  ['BACK TO THE DOME  (F)', 'RETOUR AU DÔME  (F)', 'VOLVER A LA CÚPULA  (F)', '返回穹顶  (F)'],
  ['{0} cows beamed into the CARGO BAY. Carry them to the COW LAUNCHER for kudos.', '{0} vaches téléportées dans la SOUTE. Portez-les au LANCE-VACHES pour des kudos.', '{0} vacas teletransportadas a la BODEGA. Llévalas al LANZAVACAS para ganar kudos.', '{0} 头奶牛已传送至货舱。把它们搬到奶牛发射器以获得 Kudos。'],
  ['1 cow beamed into the CARGO BAY. Carry it to the COW LAUNCHER for kudos.', '1 vache téléportée dans la SOUTE. Portez-la au LANCE-VACHES pour des kudos.', '1 vaca teletransportada a la BODEGA. Llévala al LANZAVACAS para ganar kudos.', '1 头奶牛已传送至货舱。把它搬到奶牛发射器以获得 Kudos。'],
  ['no cows caught: nothing for the cargo bay this time', 'aucune vache attrapée : rien pour la soute cette fois', 'ninguna vaca atrapada: nada para la bodega esta vez', '没有抓到奶牛：这次货舱空空如也'],
  ['You scored {0} with {1} cows. They appear to be enjoying it.', 'Vous avez marqué {0} avec {1} vaches. Elles ont l’air d’apprécier.', 'Hiciste {0} puntos con {1} vacas. Parece que lo están disfrutando.', '你用 {1} 头奶牛得到 {0} 分。它们似乎很享受。'],
  ['You scored {0} with 1 cow. It appears to be enjoying it.', 'Vous avez marqué {0} avec 1 vache. Elle a l’air d’apprécier.', 'Hiciste {0} puntos con 1 vaca. Parece que lo está disfrutando.', '你用 1 头奶牛得到 {0} 分。它似乎很享受。'],
  ['Back on the ground. The cows will be waiting.', 'De retour au sol. Les vaches attendront.', 'De vuelta en tierra. Las vacas estarán esperando.', '回到地面。奶牛会等着你。'],
  ['The transfer failed. Step into the pod again.', 'Le transfert a échoué. Entrez de nouveau dans la capsule.', 'La transferencia falló. Entra en la cápsula otra vez.', '传送失败。请再次进入舱体。'],
  ['You slipped out of the saucer. The round does not count.', 'Vous avez glissé hors de la soucoupe. La manche ne compte pas.', 'Te saliste del platillo. La ronda no cuenta.', '你从飞碟中滑出。本回合不计分。'],
  // --- kudos panel ---
  ['ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS'],
  ['KUDOS', 'KUDOS', 'KUDOS', 'KUDOS'],
  ['{0} in the cargo bay', '{0} dans la soute', '{0} en la bodega', '货舱中有 {0} 头'],
  ['{0} of yours floating outside', '{0} à vous flottent dehors', '{0} tuyas flotando afuera', '你的 {0} 头漂浮在外'],
  ['black hole in {0}', 'trou noir dans {0}', 'agujero negro en {0}', '黑洞 {0} 后到达'],
  ['10 kudos per floating cow it eats', '10 kudos par vache flottante avalée', '10 kudos por cada vaca flotante que devora', '每吞下一头漂浮的奶牛得 10 Kudos'],
  ['Carrying a cow: click the COW LAUNCHER', 'Vache en main : cliquez sur le LANCE-VACHES', 'Llevas una vaca: haz clic en el LANZAVACAS', '正抱着奶牛：点击奶牛发射器'],
  ['KUDOS buy Alien Costumes from Nov 7', 'Les KUDOS achètent des costumes aliens dès le 7 nov.', 'Los KUDOS compran trajes alienígenas desde el 7 de nov.', '11 月 7 日起可用 Kudos 购买外星服装'],
  ['hold the tab to move  ·  double-tap resets', "maintenez l'onglet pour déplacer  ·  double-clic pour réinitialiser", 'mantén la pestaña para mover  ·  doble clic restablece', '按住标签拖动  ·  双击复位'],
  // --- cargo bay & launcher ---
  ['CARGO BAY', 'SOUTE', 'BODEGA', '货舱'],
  ['Pick up cow', 'Prendre la vache', 'Recoger vaca', '抱起奶牛'],
  ['Load cow', 'Charger la vache', 'Cargar vaca', '装填奶牛'],
  ['empty: play the cow game to catch more cows\n(the saucer waits on the launch pad)', 'vide : jouez au jeu des vaches pour en attraper\n(la capsule attend sur la plateforme)', 'vacía: juega al juego de vacas para atrapar más\n(la cápsula espera en la plataforma)', '空的：玩抓牛游戏来抓更多奶牛\n（舱体在发射台等候）'],
  ['{0} cows waiting{1}\nclick one to carry it to the launcher', '{0} vaches en attente{1}\ncliquez-en une pour la porter au lanceur', '{0} vacas esperando{1}\nhaz clic en una para llevarla al lanzador', '{0} 头奶牛等待中{1}\n点击一头搬到发射器'],
  ['1 cow waiting{1}\nclick it to carry it to the launcher', '1 vache en attente{1}\ncliquez dessus pour la porter au lanceur', '1 vaca esperando{1}\nhaz clic para llevarla al lanzador', '1 头奶牛等待中{1}\n点击它搬到发射器'],
  [' ({0} more in the hold)', ' ({0} de plus dans la cale)', ' ({0} más en la bodega)', '（货舱内还有 {0} 头）'],
  ['You are already carrying a cow. Drop it in the launcher.', 'Vous portez déjà une vache. Déposez-la dans le lanceur.', 'Ya llevas una vaca. Déjala en el lanzador.', '你已经抱着一头奶牛了。把它放进发射器。'],
  ['Got one. Walk it to the COW LAUNCHER by the windows and click the barrel.', 'Attrapée. Portez-la au LANCE-VACHES près des fenêtres et cliquez sur le canon.', 'Tienes una. Llévala al LANZAVACAS junto a las ventanas y haz clic en el cañón.', '抓到了。把它搬到窗边的奶牛发射器，然后点击炮管。'],
  ['Bring a cow from the CARGO BAY first.', "Apportez d'abord une vache de la SOUTE.", 'Trae primero una vaca de la BODEGA.', '先从货舱带一头奶牛过来。'],
  ['No cows to launch. Play the cow game to catch more: the saucer waits on the launch pad.', 'Aucune vache à lancer. Jouez au jeu des vaches : la capsule attend sur la plateforme.', 'No hay vacas que lanzar. Juega al juego de vacas: la cápsula espera en la plataforma.', '没有可发射的奶牛。去玩抓牛游戏：舱体在发射台等候。'],
  ['A black hole is passing the windows. It is taking {0} cows.', 'Un trou noir passe devant les fenêtres. Il emporte {0} vaches.', 'Un agujero negro pasa por las ventanas. Se lleva {0} vacas.', '一个黑洞正经过窗外。它带走了 {0} 头奶牛。'],
  ['A black hole is passing the windows. It is taking 1 cow.', 'Un trou noir passe devant les fenêtres. Il emporte 1 vache.', 'Un agujero negro pasa por las ventanas. Se lleva 1 vaca.', '一个黑洞正经过窗外。它带走了 1 头奶牛。'],
  ['black hole in {0}  ·  {1} of yours floating', 'trou noir dans {0}  ·  {1} à vous flottent', 'agujero negro en {0}  ·  {1} tuyas flotando', '黑洞 {0} 后到达  ·  你的 {1} 头在漂浮'],
  ['{0} KUDOS per cow the black hole swallows\nKUDOS buy Alien Costumes from Nov 7', '{0} KUDOS par vache avalée par le trou noir\nLes KUDOS achètent des costumes aliens dès le 7 nov.', '{0} KUDOS por cada vaca que traga el agujero negro\nLos KUDOS compran trajes alienígenas desde el 7 de nov.', '黑洞每吞下一头奶牛得 {0} KUDOS\n11 月 7 日起可用 Kudos 购买外星服装'],
  ['Raider saucer inbound. It has a cow in its sights.', 'Soucoupe pirate en approche. Elle vise une vache.', 'Platillo saqueador en camino. Tiene una vaca en la mira.', '掠夺飞碟来袭。它盯上了一头奶牛。'],
  // --- leaderboard ---
  ['RANK', 'RANG', 'PUESTO', '名次'],
  ['PILOT', 'PILOTE', 'PILOTO', '飞行员'],
  ['NO SCORES YET — ENTER THE UFO BEAM', 'AUCUN SCORE — ENTREZ DANS LE RAYON', 'SIN PUNTUACIONES — ENTRA EN EL RAYO', '暂无成绩 — 进入飞碟光束'],
  ['BEST ROUND PER PILOT  ·  CURRENT RULESET  ·  COMMUNITY BOARD', 'MEILLEURE MANCHE PAR PILOTE  ·  RÈGLES ACTUELLES  ·  TABLEAU COMMUNAUTAIRE', 'MEJOR RONDA POR PILOTO  ·  REGLAS ACTUALES  ·  TABLA COMUNITARIA', '每位飞行员最佳回合  ·  当前规则  ·  社区榜'],
  // --- showcases, portal, ring, earth, tour ---
  ['Show {0} emote', "Voir l'emote {0}", 'Mostrar emote {0}', '展示 {0} 表情'],
  ['Show suit: {0}', 'Voir le costume : {0}', 'Mostrar traje: {0}', '展示服装：{0}'],
  ['Next emote', 'Emote suivante', 'Siguiente emote', '下一个表情'],
  ['Next costume', 'Costume suivant', 'Siguiente traje', '下一套服装'],
  ['Open selected emote on Marketplace', "Ouvrir l'emote sur le Marketplace", 'Abrir el emote en el Marketplace', '在市场中打开所选表情'],
  ['Not for sale — earned in Dungeons of Antrom', 'Pas à vendre — se gagne dans Dungeons of Antrom', 'No está a la venta — se gana en Dungeons of Antrom', '非卖品 — 在 Dungeons of Antrom 中获得'],
  ['Alien costumes are not for sale. Earn them in Dungeons of Antrom through the purple portal.', 'Les costumes aliens ne sont pas à vendre. Gagnez-les dans Dungeons of Antrom via le portail violet.', 'Los trajes alienígenas no están a la venta. Gánalos en Dungeons of Antrom por el portal morado.', '外星服装不出售。通过紫色传送门在 Dungeons of Antrom 中赢取。'],
  ['CLICK COW TO OPEN\nMARKETPLACE ITEM', 'CLIQUEZ SUR LA VACHE\nPOUR OUVRIR LE MARKETPLACE', 'CLIC EN LA VACA PARA\nABRIR EN EL MARKETPLACE', '点击奶牛打开\n市场商品'],
  ['NOT FOR SALE\nEARNED IN DUNGEONS OF ANTROM', 'PAS À VENDRE\nSE GAGNE DANS DUNGEONS OF ANTROM', 'NO ESTÁ A LA VENTA\nSE GANA EN DUNGEONS OF ANTROM', '非卖品\n在 DUNGEONS OF ANTROM 中获得'],
  ['NOT FOR SALE', 'PAS À VENDRE', 'NO ESTÁ A LA VENTA', '非卖品'],
  ['{0} MANA\n{1} LEFT', '{0} MANA\n{1} RESTANTS', '{0} MANA\n{1} QUEDAN', '{0} MANA\n剩余 {1}'],
  ['Travel to {0}?', 'Voyager vers {0} ?', '¿Viajar a {0}?', '前往 {0}？'],
  ['SOLD OUT', 'ÉPUISÉ', 'AGOTADO', '已售罄'],
  ['Enter {0} — get the alien suit', 'Entrer dans {0} — obtenir le costume alien', 'Entrar en {0} — consigue el traje alienígena', '进入 {0} — 获取外星服装'],
  ["{0}'s costume", 'Costume de {0}', 'Traje de {0}', '{0} 的服装'],
  ['Claim your Antrom Guildstone Ring', 'Réclamez votre Antrom Guildstone Ring', 'Reclama tu Antrom Guildstone Ring', '领取你的 Antrom Guildstone Ring'],
  ['Watch: how the Guildstone Ring works', 'Regarder : comment fonctionne le Guildstone Ring', 'Ver: cómo funciona el Guildstone Ring', '观看：Guildstone Ring 如何运作'],
  ['You already claimed your Antrom Guildstone Ring.', 'Vous avez déjà réclamé votre Antrom Guildstone Ring.', 'Ya reclamaste tu Antrom Guildstone Ring.', '你已经领取过 Antrom Guildstone Ring。'],
  ['The aliens are checking your wallet...', 'Les aliens vérifient votre portefeuille...', 'Los alienígenas están revisando tu billetera...', '外星人正在检查你的钱包...'],
  ['Sign in with a wallet to claim the Antrom Guildstone Ring.', 'Connectez-vous avec un portefeuille pour réclamer l’Antrom Guildstone Ring.', 'Inicia sesión con una billetera para reclamar el Antrom Guildstone Ring.', '请使用钱包登录以领取 Antrom Guildstone Ring。'],
  ['The ring vault is sealed right now. Try again later.', 'Le coffre aux anneaux est scellé pour l’instant. Réessayez plus tard.', 'La bóveda de anillos está sellada ahora. Inténtalo más tarde.', '戒指金库暂时封闭。请稍后再试。'],
  ['The aliens could not hand over a ring right now. Try again later.', 'Les aliens n’ont pas pu remettre d’anneau pour l’instant. Réessayez plus tard.', 'Los alienígenas no pudieron entregar un anillo ahora. Inténtalo más tarde.', '外星人暂时无法交付戒指。请稍后再试。'],
  ['An Antrom Guildstone Ring is on its way to your wallet. They appear to be enjoying it.', 'Un Antrom Guildstone Ring est en route vers votre portefeuille. Ils ont l’air d’apprécier.', 'Un Antrom Guildstone Ring va de camino a tu billetera. Parece que lo están disfrutando.', '一枚 Antrom Guildstone Ring 正在送往你的钱包。他们似乎很享受。'],
  ['No answer from the mothership. The ring server may be offline, try again later.', 'Pas de réponse du vaisseau-mère. Le serveur est peut-être hors ligne, réessayez plus tard.', 'Sin respuesta de la nave nodriza. El servidor puede estar fuera de línea, inténtalo más tarde.', '母舰没有回应。戒指服务器可能离线，请稍后再试。'],
  ['Zoom to Earth', 'Zoom vers la Terre', 'Zoom a la Tierra', '飞向地球'],
  ['E to skip', 'E pour passer', 'E para saltar', '按 E 跳过'],
  ['E to leave', 'E pour quitter', 'E para salir', '按 E 离开'],
  ['Back on the deck. Click the Earth any time to watch again.', 'De retour sur le pont. Cliquez sur la Terre pour revoir.', 'De vuelta en cubierta. Haz clic en la Tierra para verlo otra vez.', '回到甲板。随时点击地球再看一次。'],
  ['Take the tour', 'Faire la visite', 'Hacer el recorrido', '开始导览'],
  ['E to skip the tour', 'E pour passer la visite', 'E para saltar el recorrido', '按 E 跳过导览'],
  ['Click the cow any time for the tour again.', 'Cliquez sur la vache pour refaire la visite.', 'Haz clic en la vaca para repetir el recorrido.', '随时点击奶牛再次导览。'],
  [
    '"Moo. ...Apologies, wrong channel. This is the ship. You clicked the cow. Everyone clicks the cow. Very well: the tour."',
    '« Meuh. ...Pardon, mauvais canal. Ici le vaisseau. Vous avez cliqué sur la vache. Tout le monde clique sur la vache. Très bien : la visite. »',
    '"Muu. ...Disculpen, canal equivocado. Habla la nave. Hicieron clic en la vaca. Todos hacen clic en la vaca. Muy bien: el recorrido."',
    '“哞。……抱歉，频道错了。这里是飞船。你点了奶牛。每个人都点奶牛。好吧：开始导览。”'
  ],
  [
    '"This ship runs on a black hole. It will eat anything, but it only purrs on organic matter: carbon, water, a little grass. Feed it rocks and it sulks, and the lights go out. Ours was starting to sulk."',
    '« Ce vaisseau fonctionne grâce à un trou noir. Il avale tout, mais il ne ronronne qu’avec de la matière organique : du carbone, de l’eau, un peu d’herbe. Nourrissez-le de cailloux et il boude, et les lumières s’éteignent. Le nôtre commençait à bouder. »',
    '"Esta nave funciona con un agujero negro. Se come cualquier cosa, pero solo ronronea con materia orgánica: carbono, agua, un poco de hierba. Dale piedras y se enfurruña, y se apagan las luces. El nuestro empezaba a enfurruñarse."',
    '“这艘船靠黑洞运转。它什么都吃，但只有有机物才能让它满足：碳、水、一点草。喂它石头它就闹脾气，灯光就会熄灭。我们的黑洞开始闹脾气了。”'
  ],
  [
    '"So we went shopping. Third planet from that star, the blue one. Earth. Over a billion cows. Dense, docile, mostly water, and nobody counts them."',
    '« Alors on a fait les courses. Troisième planète de cette étoile, la bleue. La Terre. Plus d’un milliard de vaches. Denses, dociles, surtout de l’eau, et personne ne les compte. »',
    '"Así que fuimos de compras. Tercer planeta de esa estrella, el azul. La Tierra. Más de mil millones de vacas. Densas, dóciles, casi todo agua, y nadie las cuenta."',
    '“于是我们去采购。那颗恒星的第三颗行星，蓝色的那颗。地球。十亿多头奶牛。密实、温顺、大部分是水，而且没人数它们。”'
  ],
  [
    '"The transfer pod. Step inside and we drop you in a saucer over the pastures. Beam up as many cows as you can before the farmers notice. Yes, the pod is large. We had a budget."',
    '« La capsule de transfert. Entrez et nous vous déposons dans une soucoupe au-dessus des pâturages. Téléportez autant de vaches que possible avant que les fermiers ne s’en aperçoivent. Oui, la capsule est grande. Nous avions un budget. »',
    '"La cápsula de transferencia. Entra y te dejamos en un platillo sobre los pastos. Abduce todas las vacas que puedas antes de que los granjeros se den cuenta. Sí, la cápsula es grande. Teníamos presupuesto."',
    '“传送舱。走进去，我们就把你放进牧场上空的飞碟。在农夫发现之前尽可能多地吸走奶牛。是的，舱体很大。我们有预算。”'
  ],
  [
    '"Everything you beam up lands here, in the cargo bay. Pick one up — they do not mind — and carry it to the launcher."',
    '« Tout ce que vous téléportez atterrit ici, dans la soute. Prenez-en une — elles ne s’en formalisent pas — et portez-la au lanceur. »',
    '"Todo lo que abduces aterriza aquí, en la bodega. Toma una — no les importa — y llévala al lanzador."',
    '“你吸上来的一切都落在这里，货舱。抱起一头——它们不介意——搬到发射器去。”'
  ],
  [
    '"The launcher. It feeds the black hole out past the glass. Every cow you throw in earns kudos. Kudos is a currency. It buys nothing. We are very proud of it."',
    '« Le lanceur. Il nourrit le trou noir, derrière la vitre. Chaque vache lancée rapporte des kudos. Le kudos est une monnaie. Il n’achète rien. Nous en sommes très fiers. »',
    '"El lanzador. Alimenta al agujero negro, más allá del cristal. Cada vaca que lanzas da kudos. El kudos es una moneda. No compra nada. Estamos muy orgullosos."',
    '“发射器。它把奶牛送进玻璃外的黑洞。每扔进一头都能得到 Kudos。Kudos 是一种货币。什么也买不到。我们非常自豪。”'
  ],
  [
    '"Your catches go on the board. The finest abductors in the fleet. Most of them are you."',
    '« Vos prises vont au tableau. Les meilleurs ravisseurs de la flotte. La plupart, c’est vous. »',
    '"Tus capturas van a la tabla. Los mejores abductores de la flota. La mayoría eres tú."',
    '“你的战绩会上榜。舰队中最出色的绑架者。大多数都是你。”'
  ],
  [
    '"Now, the mistake. On the fourth pass the beam took a couple: two humans, from a pickup truck, mid-argument. Protocol says return them. Oddly enough... they did not want to go. They danced. We recorded it. You may own the dance."',
    '« Maintenant, l’erreur. Au quatrième passage, le rayon a pris un couple : deux humains, dans un pick-up, en pleine dispute. Le protocole dit de les rendre. Curieusement... ils ne voulaient pas partir. Ils ont dansé. Nous avons enregistré. Vous pouvez posséder la danse. »',
    '"Ahora, el error. En la cuarta pasada el rayo se llevó a una pareja: dos humanos, en una camioneta, en plena discusión. El protocolo dice devolverlos. Curiosamente... no querían irse. Bailaron. Lo grabamos. Puedes poseer el baile."',
    '“现在说说那个失误。第四次掠过时，光束抓到了一对情侣：两个人类，坐在皮卡里，正在吵架。规程说要送他们回去。奇怪的是……他们不想走。他们跳起了舞。我们录了下来。你可以拥有这支舞。”'
  ],
  [
    '"They also asked for suits like ours. We said no. They made their own. They are, honestly, better than ours."',
    '« Ils ont aussi demandé des costumes comme les nôtres. Nous avons dit non. Ils ont fait les leurs. Ils sont, franchement, mieux que les nôtres. »',
    '"También pidieron trajes como los nuestros. Dijimos que no. Hicieron los suyos. Son, sinceramente, mejores que los nuestros."',
    '“他们还想要我们这样的服装。我们拒绝了。他们就自己做了。说实话，比我们的好看。”'
  ],
  [
    '"A gift from friends in another world: the Guildstone ring. Free to claim. Take one. It is not organic. We checked."',
    '« Un cadeau d’amis d’un autre monde : l’anneau Guildstone. Gratuit. Prenez-en un. Il n’est pas organique. Nous avons vérifié. »',
    '"Un regalo de amigos de otro mundo: el anillo Guildstone. Gratis. Toma uno. No es orgánico. Lo comprobamos."',
    '“来自另一个世界朋友的礼物：Guildstone 戒指。免费领取。拿一枚吧。它不是有机物。我们检查过了。”'
  ],
  [
    '"That portal leads to the dungeons. Different ship. Different problems."',
    '« Ce portail mène aux donjons. Autre vaisseau. Autres problèmes. »',
    '"Ese portal lleva a las mazmorras. Otra nave. Otros problemas."',
    '“那个传送门通往地下城。另一艘船。另一些麻烦。”'
  ],
  [
    '"That is the tour. The pod is waiting. Bring us cows. And if you meet the couple... they are the ones enjoying it."',
    '« Voilà la visite. La capsule attend. Rapportez-nous des vaches. Et si vous croisez le couple... ce sont ceux qui apprécient. »',
    '"Ese es el recorrido. La cápsula espera. Tráenos vacas. Y si ves a la pareja... son los que lo están disfrutando."',
    '“导览到此结束。舱体在等你。给我们带奶牛来。如果你遇到那对情侣……他们就是乐在其中的那两位。”'
  ],
  // --- shared cosmos ---
  ['The black hole has fed on {0} cows. It is bigger now.', 'Le trou noir a avalé {0} vaches. Il a grossi.', 'El agujero negro se ha comido {0} vacas. Ahora es más grande.', '黑洞已经吞下 {0} 头奶牛。它变大了。'],
  ['A second ship has warped in alongside. Word is getting around.', 'Un second vaisseau vient de sortir de distorsion à côté de nous. La nouvelle se répand.', 'Una segunda nave acaba de salir del warp a nuestro lado. Se está corriendo la voz.', '第二艘飞船跃迁到了我们旁边。消息传开了。'],
  ['{0} cows fed by everyone', '{0} vaches données par tout le monde', '{0} vacas entregadas entre todos', '大家共投喂 {0} 头奶牛'],
  ['{0} more and the hole grows', 'encore {0} et le trou grossit', '{0} más y el agujero crece', '再喂 {0} 头黑洞就会变大'],
  ['the hole is as big as it gets', 'le trou est au maximum', 'el agujero ya no crece más', '黑洞已达到最大'],
  // --- radio ---
  ['Listen to the radio', 'Écouter la radio', 'Escuchar la radio', '收听广播'],
  ['DALE & TAMMY  ·  LIVE FROM THE COW SHIP', 'DALE & TAMMY  ·  EN DIRECT DU VAISSEAU À VACHES', 'DALE Y TAMMY  ·  EN VIVO DESDE LA NAVE DE LAS VACAS', 'DALE 和 TAMMY  ·  奶牛飞船现场直播'],
  ['ON AIR  ·  Episode {0}: {1}', 'À L’ANTENNE  ·  Épisode {0} : {1}', 'AL AIRE  ·  Episodio {0}: {1}', '直播中  ·  第 {0} 集：{1}'],
  ['{0} episodes on the dial  ·  click to listen', '{0} épisodes sur le cadran  ·  cliquez pour écouter', '{0} episodios en el dial  ·  haz clic para escuchar', '频道里有 {0} 集  ·  点击收听'],
  ['click to listen', 'cliquez pour écouter', 'haz clic para escuchar', '点击收听'],
  ['next episode when the hole has eaten {0} cows', 'prochain épisode quand le trou aura avalé {0} vaches', 'próximo episodio cuando el agujero se haya comido {0} vacas', '黑洞吃掉 {0} 头奶牛后解锁下一集'],
  ['New episode on the radio by the door: "{0}"', 'Nouvel épisode à la radio près de la porte : « {0} »', 'Nuevo episodio en la radio junto a la puerta: "{0}"', '门边的收音机有新一集：“{0}”'],
  ['Day One', 'Premier jour', 'Primer día', '第一天'],
  ['Ten Cows', 'Dix vaches', 'Diez vacas', '十头奶牛'],
  ['Thirty', 'Trente', 'Treinta', '三十'],
  ['Seventy-Five', 'Soixante-quinze', 'Setenta y cinco', '七十五'],
  ['Company', 'De la compagnie', 'Compañía', '有伴了'],
  ['Three Hundred', 'Trois cents', 'Trescientas', '三百'],
  // ep1
  ['Good evening from somewhere above Nebraska, this is Dale and Tammy, live from the cow ship.', 'Bonsoir de quelque part au-dessus du Nebraska, ici Dale et Tammy, en direct du vaisseau à vaches.', 'Buenas noches desde algún lugar sobre Nebraska, somos Dale y Tammy, en vivo desde la nave de las vacas.', '晚上好，这里是内布拉斯加上空某处，我们是 Dale 和 Tammy，奶牛飞船现场直播。'],
  ['We were arguing about the air filter in the truck and then the sky went green.', 'On se disputait à propos du filtre à air du pick-up et puis le ciel est devenu vert.', 'Estábamos discutiendo por el filtro de aire de la camioneta y de repente el cielo se puso verde.', '我们正为皮卡的空气滤芯吵架，然后天空就变绿了。'],
  ['He was arguing. I was correct.', 'Lui se disputait. Moi, j’avais raison.', 'Él discutía. Yo tenía razón.', '是他在吵。我是对的。'],
  ['Anyway. The aliens said sorry, we are not cows, would we like to go back.', 'Bref. Les aliens ont dit pardon, vous n’êtes pas des vaches, voulez-vous rentrer.', 'En fin. Los alienígenas dijeron perdón, no son vacas, ¿quieren volver?', '总之。外星人说抱歉，你们不是奶牛，要不要送你们回去。'],
  ["And we looked at each other, and we looked at the truck, and we said, you know what, we're good.", 'Et on s’est regardés, on a regardé le pick-up, et on a dit, vous savez quoi, ça ira.', 'Y nos miramos, miramos la camioneta, y dijimos, ¿saben qué? Estamos bien así.', '我们看了看彼此，又看了看皮卡，然后说，算了，我们挺好的。'],
  ['Honestly, best vacation we have ever had. The beds hum.', 'Franchement, nos meilleures vacances. Les lits ronronnent.', 'La verdad, las mejores vacaciones de nuestra vida. Las camas zumban.', '说实话，这是我们过得最好的假期。床会嗡嗡响。'],
  // ep2
  ['Big news on the ship today. The black hole out the window ate its tenth cow.', 'Grande nouvelle à bord. Le trou noir derrière la fenêtre a avalé sa dixième vache.', 'Gran noticia en la nave. El agujero negro de la ventana se comió su décima vaca.', '今天船上有大新闻。窗外的黑洞吃掉了第十头奶牛。'],
  ['He named them. All ten. We did not know them.', 'Il leur a donné des noms. Aux dix. On ne les connaissait pas.', 'Les puso nombre. A las diez. No las conocíamos.', '他给它们都起了名字。十头全起了。我们根本不认识它们。'],
  ['Number seven was a Gerald. You could tell.', 'La numéro sept, c’était un Gerald. Ça se voyait.', 'La número siete era un Gerald. Se notaba.', '第七头叫 Gerald。一看就知道。'],
  ['The crew says the hole purrs when it eats. I say that is a stomach noise.', 'L’équipage dit que le trou ronronne quand il mange. Moi je dis que c’est un bruit d’estomac.', 'La tripulación dice que el agujero ronronea cuando come. Yo digo que es ruido de estómago.', '船员说黑洞吃东西时会打呼噜。我说那是肚子叫。'],
  ['Either way, the lights in the hallway stopped flickering. So, thank you Gerald.', 'En tout cas, les lumières du couloir ne clignotent plus. Alors merci Gerald.', 'Sea como sea, las luces del pasillo dejaron de parpadear. Así que gracias, Gerald.', '不管怎样，走廊的灯不再闪了。所以，谢谢你 Gerald。'],
  ['Keep sending cows, folks. The hallway appreciates it.', 'Continuez à envoyer des vaches. Le couloir vous remercie.', 'Sigan mandando vacas, amigos. El pasillo lo agradece.', '大家继续送奶牛来。走廊很感激。'],
  // ep3
  ['Thirty cows in, and the black hole has, and I am quoting the captain here, filled out.', 'Trente vaches, et le trou noir s’est, je cite le capitaine, étoffé.', 'Treinta vacas, y el agujero negro se ha, y cito al capitán, rellenado.', '吃了三十头奶牛后，黑洞——这是船长的原话——丰满了。'],
  ['It is bigger. It is noticeably bigger. I measured it with my thumb.', 'Il est plus gros. Nettement plus gros. Je l’ai mesuré avec mon pouce.', 'Es más grande. Notablemente más grande. Lo medí con el pulgar.', '它更大了。明显更大了。我用拇指量过。'],
  ['He held his thumb up to a window. That is not measuring.', 'Il a levé le pouce devant une fenêtre. Ce n’est pas mesurer.', 'Levantó el pulgar frente a una ventana. Eso no es medir.', '他对着窗户竖了个拇指。那不叫量。'],
  ['Also the whole ship feels warmer. Tammy has started redecorating the pod bay.', 'Et tout le vaisseau semble plus chaud. Tammy a commencé à redécorer la baie des capsules.', 'Además toda la nave se siente más cálida. Tammy empezó a redecorar la bahía de las cápsulas.', '整艘船也感觉更暖和了。Tammy 开始重新装修舱室了。'],
  ['Somebody has to. Teal and chrome everywhere. It is like living inside a toaster.', 'Il faut bien que quelqu’un le fasse. Du bleu canard et du chrome partout. On dirait l’intérieur d’un grille-pain.', 'Alguien tiene que hacerlo. Verde azulado y cromo por todas partes. Es como vivir dentro de una tostadora.', '总得有人来。到处是蓝绿色和铬。像住在烤面包机里。'],
  ['A very comfortable toaster. We are not leaving.', 'Un grille-pain très confortable. On ne part pas.', 'Una tostadora muy cómoda. No nos vamos.', '一台非常舒服的烤面包机。我们不走了。'],
  // ep4
  ['Folks, the sky outside changed colour overnight. Seventy-five cows will do that, apparently.', 'Le ciel dehors a changé de couleur pendant la nuit. Soixante-quinze vaches, ça fait ça, paraît-il.', 'Amigos, el cielo de afuera cambió de color durante la noche. Setenta y cinco vacas hacen eso, al parecer.', '各位，外面的天空一夜之间变了颜色。七十五头奶牛就有这效果，显然。'],
  ['It is mauve.', 'C’est mauve.', 'Es malva.', '是淡紫色。'],
  ['It is purple.', 'C’est violet.', 'Es morado.', '是紫色。'],
  ['Dale, I sold curtains for eleven years. It is mauve.', 'Dale, j’ai vendu des rideaux pendant onze ans. C’est mauve.', 'Dale, vendí cortinas durante once años. Es malva.', 'Dale，我卖了十一年窗帘。是淡紫色。'],
  ['The captain says the hole is bending light now. I say it is bending my marriage.', 'Le capitaine dit que le trou courbe la lumière maintenant. Moi je dis qu’il courbe mon mariage.', 'El capitán dice que el agujero ya curva la luz. Yo digo que curva mi matrimonio.', '船长说黑洞现在能弯曲光线了。我说它在弯曲我的婚姻。'],
  ['Nothing is bending your marriage, honey. Send more cows, people. He needs a hobby.', 'Rien ne courbe ton mariage, chéri. Envoyez plus de vaches, les gens. Il lui faut un passe-temps.', 'Nada está curvando tu matrimonio, cariño. Manden más vacas, gente. Necesita un pasatiempo.', '没什么在弯曲你的婚姻，亲爱的。大家多送点奶牛。他需要个爱好。'],
  // ep5
  ['Okay, so, a second ship just warped in next to us. Hundred and fifty cows and we have neighbours.', 'Bon, alors, un second vaisseau vient de sortir de distorsion à côté de nous. Cent cinquante vaches et on a des voisins.', 'Bueno, una segunda nave acaba de salir del warp junto a nosotros. Ciento cincuenta vacas y ya tenemos vecinos.', '好吧，第二艘飞船刚跃迁到我们旁边。一百五十头奶牛，我们有邻居了。'],
  ['I think it is the in-laws.', 'Je crois que c’est la belle-famille.', 'Creo que son los suegros.', '我觉得是岳父岳母。'],
  ['It is not my mother, Dale. It is a different species.', 'Ce n’est pas ma mère, Dale. C’est une autre espèce.', 'No es mi madre, Dale. Es otra especie.', '那不是我妈，Dale。那是另一个物种。'],
  ['That is what I said.', 'C’est ce que j’ai dit.', 'Eso dije.', '我就是这么说的。'],
  ['The crew is thrilled. Apparently a hole this size draws a crowd. We are famous out here.', 'L’équipage est ravi. Apparemment un trou de cette taille attire du monde. On est célèbres par ici.', 'La tripulación está encantada. Al parecer un agujero de este tamaño atrae gente. Somos famosos por aquí.', '船员们很兴奋。显然这么大的黑洞会引来围观。我们在这儿出名了。'],
  ['Wave at the new ship if you see it. And if it waves back with a tentacle, that is Carol.', 'Faites signe au nouveau vaisseau si vous le voyez. Et s’il répond avec un tentacule, c’est Carol.', 'Saluden a la nave nueva si la ven. Y si responde con un tentáculo, esa es Carol.', '看到新飞船就挥挥手。如果它用触手回应，那就是 Carol。'],
  // ep6
  ['Three hundred cows. The black hole is enormous. You can see it from the bathroom.', 'Trois cents vaches. Le trou noir est énorme. On le voit depuis la salle de bain.', 'Trescientas vacas. El agujero negro es enorme. Se ve desde el baño.', '三百头奶牛。黑洞大得惊人。从浴室都能看见。'],
  ['It has a glow now. Like a nightlight. I have grown very fond of it.', 'Il a une lueur maintenant. Comme une veilleuse. Je m’y suis beaucoup attachée.', 'Ahora tiene un brillo. Como una lamparita de noche. Le he tomado mucho cariño.', '它现在会发光。像小夜灯。我对它很有感情了。'],
  ['The captain gave us a plaque. It says, honorary cargo. We are very proud.', 'Le capitaine nous a offert une plaque. Il y est écrit : cargaison honoraire. On est très fiers.', 'El capitán nos dio una placa. Dice: carga honoraria. Estamos muy orgullosos.', '船长给了我们一块牌匾。上面写着：荣誉货物。我们非常自豪。'],
  ['We talked about going home. For about a minute.', 'On a parlé de rentrer. Pendant environ une minute.', 'Hablamos de volver a casa. Como un minuto.', '我们谈过回家。大概谈了一分钟。'],
  ['Then the beds started humming again, and, well.', 'Puis les lits se sont remis à ronronner, et, bon.', 'Luego las camas empezaron a zumbar otra vez, y, bueno.', '然后床又开始嗡嗡响了，然后，嗯。'],
  ['This is Dale and Tammy, live from the cow ship. We are enjoying it. Good night, Earth.', 'Ici Dale et Tammy, en direct du vaisseau à vaches. On apprécie. Bonne nuit, la Terre.', 'Somos Dale y Tammy, en vivo desde la nave de las vacas. Lo estamos disfrutando. Buenas noches, Tierra.', '我们是 Dale 和 Tammy，奶牛飞船现场直播。我们很享受。晚安，地球。']
]

const MAP = new Map<string, readonly [string, string, string, string]>(ROWS.map((r) => [r[0], r]))
