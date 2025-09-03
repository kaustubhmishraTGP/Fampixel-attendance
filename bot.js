import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import cron from "node-cron";
import express from "express";

const TOKEN = process.env.TOKEN;
const STAFF_ROLE_NAME = "Staff";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// Attendance + warnings memory
let attendance = {};
let warnings = {};
let reportChannelId = null;

// ===== Express Keepalive Server =====
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(3000, () => console.log("🌐 Keepalive webserver running"));

// ===== Helper Functions =====
function getDateString() {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

async function sendDM(user, content) {
  try {
    await user.send(content);
  } catch (err) {
    console.log(`❌ Could not DM ${user.tag}`);
  }
}

async function sendEmbedDM(user, embed) {
  try {
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.log(`❌ Could not DM ${user.tag}`);
  }
}

// ===== Commands =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ?p - mark attendance
  if (command === "?p") {
    if (!message.member.roles.cache.some(r => r.name === STAFF_ROLE_NAME)) {
      return message.reply("❌ Only Staff can mark attendance.");
    }

    const today = getDateString();
    if (!attendance[today]) attendance[today] = new Set();
    if (attendance[today].has(message.author.id)) {
      return message.reply("✅ You already marked attendance today.");
    }

    attendance[today].add(message.author.id);

    const embed = new EmbedBuilder()
      .setTitle("✅ Attendance Marked")
      .setDescription(`You marked your attendance for **${today}**.`)
      .setFooter({ text: `Time: ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` })
      .setColor("Green");

    message.reply("✅ Attendance marked!");
    sendEmbedDM(message.author, embed);
  }

  // ?attendance - daily report
  if (command === "?attendance") {
    if (!message.member.permissions.has("Administrator")) return;
    const today = getDateString();
    const staff = message.guild.roles.cache.find(r => r.name === STAFF_ROLE_NAME);
    if (!staff) return message.reply("❌ Staff role not found.");

    let present = attendance[today] ? Array.from(attendance[today]) : [];
    let absent = staff.members.filter(m => !present.includes(m.id)).map(m => m.user.tag);

    const embed = new EmbedBuilder()
      .setTitle(`📋 Attendance Report - ${today}`)
      .addFields(
        { name: "✅ Present", value: present.length ? present.map(id => `<@${id}>`).join(", ") : "None" },
        { name: "❌ Absent", value: absent.length ? absent.join(", ") : "None" }
      )
      .setColor("Blue");

    message.channel.send({ embeds: [embed] });
  }

  // ?setreportchannel #channel
  if (command === "?setreportchannel") {
    if (!message.member.permissions.has("Administrator")) return;
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply("❌ Mention a valid channel.");
    reportChannelId = channel.id;
    message.reply(`✅ Report channel set to ${channel}`);
  }

  // ?top - leaderboard
  if (command === "?top") {
    if (!message.member.permissions.has("Administrator")) return;

    let scores = {};
    for (let day in attendance) {
      for (let uid of attendance[day]) {
        scores[uid] = (scores[uid] || 0) + 1;
      }
    }

    let sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const embed = new EmbedBuilder()
      .setTitle("🏆 Attendance Leaderboard")
      .setDescription(sorted.map(([id, score], i) => `**${i + 1}.** <@${id}> - ${score} days`).join("\n") || "No data")
      .setColor("Gold");

    message.channel.send({ embeds: [embed] });
  }

  // ?monthly - monthly report
  if (command === "?monthly") {
    if (!message.member.permissions.has("Administrator")) return;

    let scores = {};
    let totalDays = Object.keys(attendance).length;

    for (let day in attendance) {
      for (let uid of attendance[day]) {
        scores[uid] = (scores[uid] || 0) + 1;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("📅 Monthly Attendance Report")
      .setDescription(Object.entries(scores).map(([id, score]) => `<@${id}> - ${(score / totalDays * 100).toFixed(2)}%`).join("\n") || "No data")
      .setColor("Purple");

    message.channel.send({ embeds: [embed] });
  }

  // ?allwarnings - list warnings
  if (command === "?allwarnings") {
    if (!message.member.permissions.has("Administrator")) return;
    const embed = new EmbedBuilder()
      .setTitle("⚠️ Staff Warnings")
      .setDescription(Object.entries(warnings).map(([id, w]) => `<@${id}> - ${w} warnings`).join("\n") || "No warnings")
      .setColor("Red");

    message.channel.send({ embeds: [embed] });
  }

  // ?help - command list
  if (command === "?help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 Bot Commands")
      .setDescription("Commands for attendance bot")
      .addFields(
        { name: "?p", value: "Mark attendance (Staff only)" },
        { name: "?attendance", value: "Check daily attendance (Admin)" },
        { name: "?setreportchannel #channel", value: "Set weekly report channel (Admin)" },
        { name: "?top", value: "View attendance leaderboard (Admin)" },
        { name: "?monthly", value: "View monthly report (Admin)" },
        { name: "?allwarnings", value: "List warnings (Admin)" },
        { name: "?help", value: "Show this help" }
      )
      .setColor("Blue");

    message.channel.send({ embeds: [embed] });
  }
});

// ===== Cron Jobs =====

// Reset daily at 12 AM IST
cron.schedule("0 0 * * *", async () => {
  const today = getDateString();
  const guilds = client.guilds.cache;

  for (let guild of guilds.values()) {
    const staff = guild.roles.cache.find(r => r.name === STAFF_ROLE_NAME);
    if (!staff) continue;

    let present = attendance[today] ? Array.from(attendance[today]) : [];
    let absentMembers = staff.members.filter(m => !present.includes(m.id));

    absentMembers.forEach(m => {
      warnings[m.id] = (warnings[m.id] || 0) + 1;
      sendDM(m.user, `❌ You were absent on ${today}. Total warnings: ${warnings[m.id]}`);

      if (warnings[m.id] >= 10) {
        m.roles.remove(staff).catch(() => {});
        sendDM(m.user, "🚫 You have been removed from Staff due to 10 warnings.");
      }
    });
  }
}, { timezone: "Asia/Kolkata" });

// Reminder DM at 12 PM IST
cron.schedule("0 12 * * *", async () => {
  const today = getDateString();
  for (let guild of client.guilds.cache.values()) {
    const staff = guild.roles.cache.find(r => r.name === STAFF_ROLE_NAME);
    if (!staff) continue;

    staff.members.forEach(m => {
      if (!attendance[today] || !attendance[today].has(m.id)) {
        sendDM(m.user, "⏰ Reminder: Please mark your attendance today using `?p`.");
      }
    });
  }
}, { timezone: "Asia/Kolkata" });

// Weekly report every Sunday 12 PM IST
cron.schedule("0 12 * * 0", async () => {
  if (!reportChannelId) return;
  const channel = await client.channels.fetch(reportChannelId).catch(() => null);
  if (!channel) return;

  let scores = {};
  for (let day in attendance) {
    for (let uid of attendance[day]) {
      scores[uid] = (scores[uid] || 0) + 1;
    }
  }

  let sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const embed = new EmbedBuilder()
    .setTitle("📊 Weekly Attendance Report")
    .setDescription(sorted.map(([id, score], i) => `**${i + 1}.** <@${id}> - ${score} days`).join("\n") || "No data")
    .setColor("Aqua");

  channel.send({ embeds: [embed] });
}, { timezone: "Asia/Kolkata" });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
