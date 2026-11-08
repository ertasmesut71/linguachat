const store = require("./store");
const { hashPassword } = require("../utils/hash");

const DEMO_USERS = [
  { email: "alex@linguachat.io", password: "password123", displayName: "Alex Thompson", primaryLang: "en", bio: "Full-stack dev & polyglot explorer" },
  { email: "ayumi@linguachat.io", password: "password123", displayName: "Ayumi Tanaka", primaryLang: "ja", bio: "東京からこんにちは 🗼" },
  { email: "carlos@linguachat.io", password: "password123", displayName: "Carlos García", primaryLang: "es", bio: "Hola desde Madrid 🇪🇸" },
  { email: "elif@linguachat.io", password: "password123", displayName: "Elif Yılmaz", primaryLang: "tr", bio: "İstanbul'dan selamlar 🌉" },
  { email: "pierre@linguachat.io", password: "password123", displayName: "Pierre Dubois", primaryLang: "fr", bio: "Bonjour de Paris 🥐" },
  { email: "mei@linguachat.io", password: "password123", displayName: "Mei Chen", primaryLang: "zh", bio: "从北京问好 🏯" },
];

async function seed() {
  console.log("🌱 Seeding database...\n");

  // Clear existing data in dependency order
  if (store.prisma) {
    try {
      await store.prisma.translation.deleteMany();
      await store.prisma.messageReceipt.deleteMany();
      await store.prisma.message.deleteMany();
      await store.prisma.chatMember.deleteMany();
      await store.prisma.chat.deleteMany();
      await store.prisma.refreshToken.deleteMany();
      await store.prisma.user.deleteMany();
      console.log("  ✓ Cleared existing data\n");
    } catch (err) {
      console.log("  ⚠ Could not clear (tables may not exist yet):", err.message, "\n");
    }
  }

  const created = [];
  for (const u of DEMO_USERS) {
    const hash = await hashPassword(u.password);
    const user = await store.createUser({
      email: u.email, passwordHash: hash, displayName: u.displayName,
      primaryLang: u.primaryLang, bio: u.bio,
    });
    if (["en", "ja", "fr"].includes(u.primaryLang)) await store.updateUserStatus(user.id, "online");
    created.push(user);
    console.log(`  ✓ User: ${user.displayName} (${u.primaryLang})`);
  }

  const [alex, ayumi, carlos, elif, pierre, mei] = created;

  const directPairs = [
    [alex, ayumi],
    [alex, carlos],
    [alex, elif],
    [alex, pierre],
  ];

  for (const [a, b] of directPairs) {
    const chat = await store.createChat({ type: "direct", createdBy: a.id });
    await store.addChatMember({ chatId: chat.id, userId: a.id, role: "member", receiveLang: a.primaryLang, autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: b.id, role: "member", receiveLang: b.primaryLang, autoTranslate: true });

    const msgs = getSampleMessages(a, b);
    for (const msg of msgs) {
      await store.createMessage({ chatId: chat.id, senderId: msg.senderId, type: "text", content: msg.content });
    }
    console.log(`  ✓ Chat: ${a.displayName} ↔ ${b.displayName}`);
  }

  const group = await store.createChat({ type: "group", name: "Global Team 🌍", description: "Multilingual project coordination", createdBy: alex.id });
  const groupMembers = [alex, ayumi, carlos, pierre, mei];
  for (const u of groupMembers) {
    await store.addChatMember({
      chatId: group.id, userId: u.id,
      role: u.id === alex.id ? "owner" : "member",
      receiveLang: u.primaryLang, autoTranslate: true,
    });
  }
  const groupMsgs = [
    { senderId: ayumi.id, content: "チームの皆さん、今週の進捗を共有しましょう。" },
    { senderId: carlos.id, content: "Mi parte del frontend está casi terminada." },
    { senderId: pierre.id, content: "J'ai terminé l'intégration de l'API." },
    { senderId: mei.id, content: "后端优化已经完成了。" },
    { senderId: alex.id, content: "Great progress everyone! Let's sync up tomorrow." },
  ];
  for (const msg of groupMsgs) {
    await store.createMessage({ chatId: group.id, senderId: msg.senderId, type: "text", content: msg.content });
  }
  console.log(`  ✓ Group: ${group.name}`);

  console.log("\n✅ Seed complete.\n");
  return created;
}

function getSampleMessages(userA, userB) {
  const langMsgs = {
    ja: ["こんにちは！今日のミーティングについて話しましょう。", "新しいプロジェクトの提案書を準備しました。"],
    es: ["¡Hola! ¿Cómo va el proyecto de traducción?", "Perfecto. Necesitamos probarlo con más idiomas."],
    tr: ["Merhaba! Yeni tasarımlar hazır mı?", "Tamam, yarın tekrar konuşalım."],
    fr: ["Bonjour! As-tu vu les dernières modifications?", "Parfait, je vais les intégrer ce soir."],
  };
  const enReplies = ["Hi! Yes, let's discuss that.", "Sure, I'll review it right away."];
  const foreign = langMsgs[userB.primaryLang] || ["Hello!", "Sounds good!"];
  return [
    { senderId: userB.id, content: foreign[0] },
    { senderId: userA.id, content: enReplies[0] },
    { senderId: userB.id, content: foreign[1] },
    { senderId: userA.id, content: enReplies[1] },
  ];
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { seed };
