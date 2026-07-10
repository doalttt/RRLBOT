const { Client, GatewayIntentBits, ComponentType, ButtonStyle, MessageFlags, REST, Routes, SlashCommandBuilder } = require('discord.js')
require('dotenv').config()
const https = require('https')
const fs = require('fs')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
})

const STAFF_ROLE_ID = '1491683467917000795'
const DEV_ROLE_ID = '1491683215549923459'
const SENIOR_STAFF_ROLE_ID = '1491683379194888366'
const TICKET_CATEGORY_ID = '1517445573735612549'
const STATUS_CHANNEL_ID = '1525065072509063238'
const TICKET_STAFF_ROLE = STAFF_ROLE_ID
const TICKET_DEV_ROLE = DEV_ROLE_ID
const PING_ROLE_ID = '1495670066203590796'
const aiConversations = new Map()
const aiCooldowns = new Map()
const AI_CHANNEL_ID = '1491702338807926814'

const WARNINGS_FILE = './warnings.json'

function loadWarnings() {
  try {
    if (!fs.existsSync(WARNINGS_FILE)) return {}
    return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'))
  } catch (err) {
    console.error('Failed to load warnings:', err)
    return {}
  }
}

function saveWarnings(data) {
  try {
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('Failed to save warnings:', err)
  }
}

function addWarning(userId, reason, modId) {
  const data = loadWarnings()
  if (!data[userId]) data[userId] = []
  data[userId].push({ reason, modId, timestamp: Date.now() })
  saveWarnings(data)
  return data[userId].length
}

function getWarnings(userId) {
  const data = loadWarnings()
  return data[userId] || []
}

function clearWarnings(userId) {
  const data = loadWarnings()
  delete data[userId]
  saveWarnings(data)
}

function hasStaffRole(memberOrMessage) {
  const member = memberOrMessage.member || memberOrMessage
  return member.roles.cache.has(STAFF_ROLE_ID) || member.roles.cache.has(DEV_ROLE_ID)
}

function hasSeniorStaffRole(member) {
  return member.roles.cache.has(SENIOR_STAFF_ROLE_ID) || member.roles.cache.has(DEV_ROLE_ID)
}

const commands = [
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Post a game update')
    .addStringOption(option => option.setName('title').setDescription('Title of the update').setRequired(true))
    .addStringOption(option => option.setName('desc').setDescription('Description of the update').setRequired(true))
    .addBooleanOption(option => option.setName('ping').setDescription('Ping update role?').setRequired(true))
    .addStringOption(option => option.setName('extra').setDescription('Any extra info (optional)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket creation panel'),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(option => option.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for warning').setRequired(true)),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a user\'s warnings')
    .addUserOption(option => option.setName('user').setDescription('User to check').setRequired(true)),
  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all warnings for a user')
    .addUserOption(option => option.setName('user').setDescription('User to clear').setRequired(true)),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a user')
    .addUserOption(option => option.setName('user').setDescription('User to mute').setRequired(true))
    .addIntegerOption(option => option.setName('minutes').setDescription('Duration in minutes').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for mute').setRequired(false)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout from a user')
    .addUserOption(option => option.setName('user').setDescription('User to unmute').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user')
    .addUserOption(option => option.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for ban').setRequired(false)),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .addStringOption(option => option.setName('userid').setDescription('User ID to unban').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user')
    .addUserOption(option => option.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for kick').setRequired(false)),
  new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a plain DM to a user')
    .addUserOption(option => option.setName('user').setDescription('User to message').setRequired(true))
    .addStringOption(option => option.setName('content').setDescription('Message content').setRequired(true)),
  new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Add a user to the current ticket')
    .addUserOption(option => option.setName('user').setDescription('User to add').setRequired(true)),
  new SlashCommandBuilder()
    .setName('reopenticket')
    .setDescription('Reopen a closed ticket')
].map(command => command.toJSON())

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`)
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)
  try {
    console.log('Registering slash commands...')
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
    console.log('Slash commands registered!')
  } catch (error) {
    console.error('Failed to register commands:', error)
  }

  try {
    const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID)
    if (statusChannel) await statusChannel.setName('LegacyBot (Online)')
  } catch (err) {
    console.error('Failed to set status channel:', err)
  }
})

client.on('interactionCreate', async interaction => {

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    const ticketType = interaction.values[0]

    const typeNames = {
      reporting: 'Reporting',
      help: 'Help',
      exploit: 'Exploit Report',
      bug: 'Bug Report',
      appeal: 'Ban Appeal'
    }

    const guild = interaction.guild
    const category = guild.channels.cache.get(TICKET_CATEGORY_ID)

    const userTickets = guild.channels.cache.filter(c =>
      c.topic === `ticket-${interaction.user.id}` && c.parentId === TICKET_CATEGORY_ID
    )

    if (userTickets.size >= 3) {
      return interaction.reply({ content: `❌ You already have ${userTickets.size} open tickets. Please close one before opening another.`, ephemeral: true })
    }

    await interaction.reply({ content: '🎫 Creating your ticket...', ephemeral: true })

    try {
      const channel = await guild.channels.create({
        name: `${ticketType}-${interaction.user.username}`,
        parent: category ? category.id : null,
        topic: `ticket-${interaction.user.id}`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
          { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'AddReactions'] },
          { id: TICKET_STAFF_ROLE, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          { id: TICKET_DEV_ROLE, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
        ]
      })

      await channel.send(`<@${interaction.user.id}> <@&${TICKET_STAFF_ROLE}>`)

      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: ComponentType.Container,
            components: [
              { type: ComponentType.TextDisplay, content: `# 🎫 ${typeNames[ticketType]} Ticket` },
              { type: ComponentType.TextDisplay, content: `Opened by <@${interaction.user.id}>` },
              { type: ComponentType.Separator },
              { type: ComponentType.TextDisplay, content: 'A staff member will be with you shortly. Please describe your issue in as much detail as possible.' },
              { 
                type: ComponentType.ActionRow,
                components: [
                  { type: ComponentType.Button, label: 'Close With Reason', style: ButtonStyle.Primary, custom_id: `ticket_close_${channel.id}`, emoji: { name: '📝' } },
                  { type: ComponentType.Button, label: 'Close', style: ButtonStyle.Secondary, custom_id: `ticket_close_reason_${channel.id}`, emoji: { name: '🔒' } },
                  { type: ComponentType.Button, label: 'Reopen', style: ButtonStyle.Success, custom_id: `ticket_reopen_${channel.id}`, emoji: { name: '🔓' } },
                  { type: ComponentType.Button, label: 'Delete (Admin Only)', style: ButtonStyle.Danger, custom_id: `ticket_delete_${channel.id}`, emoji: { name: '🗑️' } }
                ]
              }
            ]
          }
        ]
      })

      await interaction.followUp({ content: `✅ Ticket created: ${channel}`, ephemeral: true })
    } catch (err) {
      console.error('Failed to create ticket:', err)
      await interaction.followUp({ content: '❌ Something went wrong creating your ticket. Please ping a staff member.', ephemeral: true })
    }
    return
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_close_reason_')) {
    const member = interaction.member
    if (!member.roles.cache.has(TICKET_STAFF_ROLE) && !member.roles.cache.has(TICKET_DEV_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to close tickets.', ephemeral: true })
    }

    await interaction.reply({ content: '🔒 This ticket has been closed and will be archived in 5 seconds.' })
    await interaction.channel.permissionOverwrites.edit(interaction.channel.guild.roles.everyone, { ViewChannel: false })

    const ticketOwnerId = interaction.channel.topic?.replace('ticket-', '')
    if (ticketOwnerId) {
      await interaction.channel.permissionOverwrites.edit(ticketOwnerId, { ViewChannel: false }).catch(() => {})
    }
    return
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_close_') && !interaction.customId.startsWith('ticket_close_reason_')) {
    const member = interaction.member
    if (!member.roles.cache.has(TICKET_STAFF_ROLE) && !member.roles.cache.has(TICKET_DEV_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to close tickets.', ephemeral: true })
    }

    await interaction.showModal({
      title: 'Close Ticket With Reason',
      custom_id: `ticket_close_reason_modal_${interaction.channel.id}`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.TextInput,
              custom_id: 'close_reason_input',
              label: 'Reason for closing',
              style: 2,
              required: true,
              max_length: 300
            }
          ]
        }
      ]
    })
    return
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_delete_')) {
    const member = interaction.member
    if (!member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'Only admins can delete tickets.', ephemeral: true })
    }

    await interaction.reply({ content: '🗑️ Deleting this ticket in 3 seconds...' })
    setTimeout(() => {
      interaction.channel.delete().catch(() => {})
    }, 3000)
    return
  }
  if (interaction.isButton() && interaction.customId.startsWith('ticket_reopen_')) {
    const member = interaction.member
    if (!member.roles.cache.has(TICKET_STAFF_ROLE) && !member.roles.cache.has(TICKET_DEV_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to reopen tickets.', ephemeral: true })
    }

    const ticketOwnerId = interaction.channel.topic?.replace('ticket-', '')

    await interaction.channel.permissionOverwrites.edit(interaction.channel.guild.roles.everyone, { ViewChannel: false })

    if (ticketOwnerId) {
      await interaction.channel.permissionOverwrites.edit(ticketOwnerId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalEmojis: true,
        AddReactions: true
      }).catch(() => {})
    }

    await interaction.reply({ content: '🔓 Ticket has been reopened.' })
    return
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_close_reason_modal_')) {
    const reason = interaction.fields.getTextInputValue('close_reason_input')

    await interaction.reply({ content: `🔒 Ticket closed.\n**Reason:** ${reason}` })
    await interaction.channel.permissionOverwrites.edit(interaction.channel.guild.roles.everyone, { ViewChannel: false })

    const ticketOwnerId = interaction.channel.topic?.replace('ticket-', '')
    if (ticketOwnerId) {
      await interaction.channel.permissionOverwrites.edit(ticketOwnerId, { ViewChannel: false }).catch(() => {})
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'adduser') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    if (!interaction.channel.topic?.startsWith('ticket-')) {
      return interaction.reply({ content: '❌ This command can only be used inside a ticket channel.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')

    try {
      await interaction.channel.permissionOverwrites.edit(target.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalEmojis: true,
        AddReactions: true
      })
      await interaction.reply({ content: `✅ Added <@${target.id}> to the ticket.` })
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to add user to the ticket.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'reopenticket') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    if (!interaction.channel.topic?.startsWith('ticket-')) {
      return interaction.reply({ content: '❌ This command can only be used inside a ticket channel.', ephemeral: true })
    }

    const ticketOwnerId = interaction.channel.topic.replace('ticket-', '')

    await interaction.channel.permissionOverwrites.edit(interaction.channel.guild.roles.everyone, { ViewChannel: false })

    if (ticketOwnerId) {
      await interaction.channel.permissionOverwrites.edit(ticketOwnerId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
        UseExternalEmojis: true,
        AddReactions: true
      }).catch(() => {})
    }

    await interaction.reply({ content: '🔓 Ticket has been reopened.' })
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticketpanel') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    await interaction.reply({ content: '✅ Ticket panel sent!', ephemeral: true })
    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 🎫 Open a Ticket' },
            { type: ComponentType.TextDisplay, content: 'Select a category below that best fits your issue, and a private ticket channel will be created for you.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: 'Please Note: when you select a dropdown, there is no confirmation and the ticket will be created.' },
            { type: ComponentType.TextDisplay, content: '⚠️ Opening tickets for no reason results in a warning.' },
            { type: ComponentType.Separator },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.StringSelect,
                  custom_id: 'ticket_select',
                  placeholder: 'Select a ticket type...',
                  options: [
                    { label: 'Reporting', value: 'reporting', emoji: { name: '🚩' } },
                    { label: 'Help', value: 'help', emoji: { name: '❓' } },
                    { label: 'Exploit Report', value: 'exploit', emoji: { name: '⚠️' } },
                    { label: 'Bug Report', value: 'bug', emoji: { name: '🐛' } },
                    { label: 'Ban Appeal', value: 'appeal', emoji: { name: '⚖️' } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'warn') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const reason = interaction.options.getString('reason')
    const count = addWarning(target.id, reason, interaction.user.id)

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: `# ⚠️ Warning Issued` },
            { type: ComponentType.TextDisplay, content: `**User:** <@${target.id}>\n**Reason:** ${reason}\n**Total Warnings:** ${count}\n**Issued by:** <@${interaction.user.id}>` }
          ]
        }
      ]
    })

    try {
      await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total Warnings:** ${count}`)
    } catch (err) {}
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'warnings') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const warnings = getWarnings(target.id)

    if (warnings.length === 0) {
      return interaction.reply({ content: `<@${target.id}> has no warnings.`, ephemeral: true })
    }

    const list = warnings.map((w, i) => `**${i + 1}.** ${w.reason}\n*By <@${w.modId}> • <t:${Math.floor(w.timestamp / 1000)}:R>*`).join('\n\n')

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: `# 📋 Warnings for <@${target.id}>` },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: list }
          ]
        }
      ],
      ephemeral: true
    })
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'clearwarnings') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    clearWarnings(target.id)
    return interaction.reply({ content: `✅ Cleared all warnings for <@${target.id}>.`, ephemeral: true })
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'mute') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const minutes = interaction.options.getInteger('minutes')
    const reason = interaction.options.getString('reason') || 'No reason provided'

    try {
      const member = await interaction.guild.members.fetch(target.id)
      await member.timeout(minutes * 60 * 1000, reason)

      await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: ComponentType.Container,
            components: [
              { type: ComponentType.TextDisplay, content: `# 🔇 User Muted` },
              { type: ComponentType.TextDisplay, content: `**User:** <@${target.id}>\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}\n**Issued by:** <@${interaction.user.id}>` }
            ]
          }
        ]
      })
    } catch (err) {
      console.error('Failed to mute:', err)
      await interaction.reply({ content: '❌ Failed to mute this user. They may have a higher role than the bot.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'unmute') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')

    try {
      const member = await interaction.guild.members.fetch(target.id)
      await member.timeout(null)
      await interaction.reply({ content: `✅ <@${target.id}> has been unmuted.`, ephemeral: true })
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to unmute this user.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
    if (!hasSeniorStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command. Banning requires a higher staff role.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const reason = interaction.options.getString('reason') || 'No reason provided'

    try {
      try {
        await target.send(`🔨 You have been banned from **${interaction.guild.name}**.\n**Reason:** ${reason}`)
      } catch (err) {}

      await interaction.guild.members.ban(target.id, { reason })

      await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: ComponentType.Container,
            components: [
              { type: ComponentType.TextDisplay, content: `# 🔨 User Banned` },
              { type: ComponentType.TextDisplay, content: `**User:** <@${target.id}> (${target.id})\n**Reason:** ${reason}\n**Issued by:** <@${interaction.user.id}>` }
            ]
          }
        ]
      })
    } catch (err) {
      console.error('Failed to ban:', err)
      await interaction.reply({ content: '❌ Failed to ban this user. They may have a higher role than the bot.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'unban') {
    if (!hasSeniorStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command. Unbanning requires a higher staff role.', ephemeral: true })
    }

    const userId = interaction.options.getString('userid')

    try {
      await interaction.guild.members.unban(userId)
      await interaction.reply({ content: `✅ Unbanned user with ID ${userId}.`, ephemeral: true })
    } catch (err) {
      await interaction.reply({ content: '❌ Failed to unban — check the user ID is correct and they are actually banned.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'kick') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const reason = interaction.options.getString('reason') || 'No reason provided'

    try {
      try {
        await target.send(`👢 You have been kicked from **${interaction.guild.name}**.\n**Reason:** ${reason}`)
      } catch (err) {}

      const member = await interaction.guild.members.fetch(target.id)
      await member.kick(reason)

      await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          {
            type: ComponentType.Container,
            components: [
              { type: ComponentType.TextDisplay, content: `# 👢 User Kicked` },
              { type: ComponentType.TextDisplay, content: `**User:** <@${target.id}>\n**Reason:** ${reason}\n**Issued by:** <@${interaction.user.id}>` }
            ]
          }
        ]
      })
    } catch (err) {
      console.error('Failed to kick:', err)
      await interaction.reply({ content: '❌ Failed to kick this user. They may have a higher role than the bot.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'message') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true })
    }

    const target = interaction.options.getUser('user')
    const content = interaction.options.getString('content')

    try {
      await target.send(content)
      await interaction.reply({ content: `✅ Message sent to <@${target.id}>.`, ephemeral: true })
    } catch (err) {
      await interaction.reply({ content: '❌ Could not DM this user. They may have DMs disabled.', ephemeral: true })
    }
    return
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'update') {
    if (!hasStaffRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to post updates.', ephemeral: true })
    }

    const title = interaction.options.getString('title')
    const desc = interaction.options.getString('desc')
    const ping = interaction.options.getBoolean('ping')
    const extra = interaction.options.getString('extra')

    const embedComponents = [
      { type: ComponentType.TextDisplay, content: `# 📢 ${title}` },
      { type: ComponentType.Separator },
      { type: ComponentType.TextDisplay, content: desc }
    ]

    if (extra) {
      embedComponents.push({ type: ComponentType.Separator })
      embedComponents.push({ type: ComponentType.TextDisplay, content: `### 📝 Extra Info\n${extra}` })
    }

    embedComponents.push({ type: ComponentType.Separator })
    embedComponents.push({ type: ComponentType.TextDisplay, content: `*Posted by <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:F>*` })

    try {
      await interaction.reply({ content: '✅ Update posted!', ephemeral: true })
      const updateChannel = client.channels.cache.get('1491702133790343218')
      await updateChannel.send({
        content: ping ? `<@&${PING_ROLE_ID}>` : undefined,
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.Container, components: embedComponents }]
      })
    } catch (err) {
      console.error('Failed to post update:', err)
    }
    return
  }

if (interaction.isButton()) {
    const roleMap = {
      role_tag: '1495624606730682428',
      role_pings: '1495670066203590796',
      verify_member: '1491684391066537984',
      role_vr: '1497419431612252240',
      role_screenmode: '1497419559878262966',
      role_offtopic: '1499357606228136008'
    }

    const roleId = roleMap[interaction.customId]
    if (!roleId) return

    const member = interaction.member
    const role = interaction.guild.roles.cache.get(roleId)

    if (!role) return interaction.reply({ content: 'Role not found.', ephemeral: true })

    if (interaction.customId === 'verify_member') {
      if (member.roles.cache.has(roleId)) {
        return interaction.reply({ content: 'You are already verified!', ephemeral: true })
      }

      const accountAge = Date.now() - interaction.user.createdTimestamp
      const threeDays = 3 * 24 * 60 * 60 * 1000

      if (accountAge < threeDays) {
        return interaction.reply({
          content: '❌ Your Discord account must be older than 3 days to verify. Please try again later.',
          ephemeral: true
        })
      }

      await member.roles.add(role)
      return interaction.reply({ content: '✅ You have been verified! Welcome to the server.', ephemeral: true })
    }

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role)
      return interaction.reply({ content: `Removed <@&${roleId}>.`, ephemeral: true })
    } else {
      await member.roles.add(role)
      return interaction.reply({ content: `Added <@&${roleId}>!`, ephemeral: true })
    }
  }
})

client.on('guildMemberAdd', async member => {
  const welcomeChannel = client.channels.cache.get('1466107491724038312')
  if (!welcomeChannel) return

  const createdAt = Math.floor(member.user.createdTimestamp / 1000)

  await welcomeChannel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.Section,
            components: [
              { type: ComponentType.TextDisplay, content: `# 👋 Welcome to Rec Room Legacy!` },
              { type: ComponentType.TextDisplay, content: `Hey <@${member.user.id}>, welcome to the server! We're glad to have you here.` },
              { type: ComponentType.Separator },
              { type: ComponentType.TextDisplay, content: `### 👤 ${member.user.username}\n🗓️ Account Created: <t:${createdAt}:D>\n📅 Joined: <t:${Math.floor(Date.now() / 1000)}:D>` }
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: member.user.displayAvatarURL({ size: 256 })
              }
            }
          }
        ]
      }
    ]
  })
})

client.on('messageCreate', async message => {
  if (message.author.bot) return

if (message.mentions.has(client.user)) {
    const now = Date.now()
    const cooldown = 6500
    const lastUsed = aiCooldowns.get(message.author.id) || 0

    if (now - lastUsed < cooldown) {
      const remaining = ((cooldown - (now - lastUsed)) / 1000).toFixed(1)
      return message.reply(`Chill! You can talk to me again in **${remaining}s**`)
    }

    const AI_ALLOWED_CHANNEL = '1525136726257959072'
    const isStaff = message.member.roles.cache.has(STAFF_ROLE_ID) || message.member.roles.cache.has(DEV_ROLE_ID)

    if (message.channel.id !== AI_ALLOWED_CHANNEL && !isStaff) return

    aiCooldowns.set(message.author.id, now)

    let userMessage = message.content.replace(/<@!?[0-9]+>/g, '').trim()
    if (!userMessage && message.attachments.size === 0) return message.reply('Hey! How can I help you?')

    const guild = message.guild
    const onlineMembers = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size
    const totalMembers = guild.memberCount
    const boostLevel = guild.premiumTier
    const boostCount = guild.premiumSubscriptionCount
    const userRoles = message.member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') || 'None'
    const channelName = message.channel.name
    const channelTopic = message.channel.topic || 'No topic set'
    const botUptime = process.uptime()
    const uptimeStr = `${Math.floor(botUptime / 3600)}h ${Math.floor((botUptime % 3600) / 60)}m ${Math.floor(botUptime % 60)}s`
    const memUsage = process.memoryUsage()
    const memStr = `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
    const currentTime = new Date().toUTCString()

    let recentMessages = ''
    try {
      const fetched = await message.channel.messages.fetch({ limit: 5 })
      recentMessages = fetched.reverse().map(m => `${m.author.username}: ${m.content}`).filter(m => m).join('\n')
    } catch (err) {}

    const authorInfo = `[The user talking to you is: ${message.author.username} (Display name: ${message.member?.displayName || message.author.username}, Roles: ${userRoles}, Account created: ${new Date(message.author.createdTimestamp).toDateString()}, Joined server: ${message.member?.joinedAt ? new Date(message.member.joinedAt).toDateString() : 'unknown'}, Avatar: ${message.author.displayAvatarURL()})]`

    const attachmentInfo = message.attachments.size > 0
      ? `[${message.author.username} attached ${message.attachments.size} file(s): ${message.attachments.map(a => `${a.name} (${a.contentType || 'unknown type'}) - ${a.url}`).join(', ')}]`
      : ''

    const serverInfo = `[Server info: Name: ${guild.name}, Members: ${totalMembers} total, Boost level: ${boostLevel}, Boosts: ${boostCount}, Current channel: #${channelName}, Channel topic: ${channelTopic}]`

    const botInfo = `[Bot info: Uptime: ${uptimeStr}, Memory usage: ${memStr}, Current time (UTC): ${currentTime}]`

    const recentContext = recentMessages ? `[Recent messages in #${channelName}:\n${recentMessages}]` : ''

    if (message.reference) {
      try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId)
        const repliedContent = repliedTo.content || '[no text content]'
        const repliedAuthor = repliedTo.author.username
        const repliedDisplayName = repliedTo.member?.displayName || repliedTo.author.username
        const repliedAvatar = repliedTo.author.displayAvatarURL()
        const repliedJoined = repliedTo.member?.joinedAt ? new Date(repliedTo.member.joinedAt).toDateString() : 'unknown'
        const repliedAttachments = repliedTo.attachments.size > 0
          ? `[That message has ${repliedTo.attachments.size} attachment(s): ${repliedTo.attachments.map(a => `${a.name} (${a.contentType || 'unknown type'}) - ${a.url}`).join(', ')}]`
          : ''
        userMessage = `${authorInfo}\n${serverInfo}\n${botInfo}\n${recentContext}\n${attachmentInfo}\n[${message.author.username} is replying to a DIFFERENT person: ${repliedAuthor} (Display name: ${repliedDisplayName}, Joined: ${repliedJoined}, Avatar: ${repliedAvatar}) who said: "${repliedContent}" ${repliedAttachments}]\n[${message.author.username} says to you:] ${userMessage}`
      } catch (err) {
        userMessage = `${authorInfo}\n${serverInfo}\n${botInfo}\n${recentContext}\n${attachmentInfo}\n[${message.author.username} says to you:] ${userMessage}`
      }
    } else {
      userMessage = `${authorInfo}\n${serverInfo}\n${botInfo}\n${recentContext}\n${attachmentInfo}\n[${message.author.username} says to you:] ${userMessage}`
    }

    try {
      const hasOwnAttachment = message.attachments.size > 0
      const isReplyingToAttachment = message.reference && userMessage.includes('That message has')
      const rawContent = message.content.replace(/<@!?[0-9]+>/g, '').trim().toLowerCase()
      const imageTriggers = ['generate', 'draw', 'image', 'picture', 'photo', 'art']
      const shouldGenerateImage = !hasOwnAttachment && !isReplyingToAttachment && imageTriggers.some(t => rawContent.includes(t))

      if (shouldGenerateImage) {
        try {
          await message.channel.sendTyping()
          const prompt = encodeURIComponent(message.content.replace(/<@!?[0-9]+>/g, '').trim())
          const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&nologo=true`

          const imageBuffer = await new Promise((resolve, reject) => {
            const makeRequest = (url, redirectCount = 0) => {
              if (redirectCount > 5) return reject(new Error('Too many redirects'))
              const protocol = url.startsWith('https') ? require('https') : require('http')
              protocol.get(url, res => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                  return makeRequest(res.headers.location, redirectCount + 1)
                }
                const chunks = []
                res.on('data', chunk => chunks.push(chunk))
                res.on('end', () => resolve(Buffer.concat(chunks)))
                res.on('error', reject)
              }).on('error', reject)
            }
            makeRequest(imageUrl)
          })

          await message.reply({ files: [{ attachment: imageBuffer, name: 'image.png' }] })
        } catch (err) {
          console.error('Image generation failed:', err)
          await message.reply('❌ Failed to generate image, try again!')
        }
        return
      }

      const mathMatch = rawContent.match(/[\d+\-*/().% ]{3,}/)
      if (mathMatch && (rawContent.includes('calculate') || rawContent.includes('math') || rawContent.includes('what is') && rawContent.match(/[\d+\-*/]/))) {
        try {
          const result = Function('"use strict"; return (' + mathMatch[0] + ')')()
          await message.reply(`🧮 ${mathMatch[0].trim()} = **${result}**`)
          return
        } catch (err) {}
      }

      if (rawContent.includes('roll') || rawContent.includes('dice')) {
        const match = rawContent.match(/(\d+)d(\d+)/) || rawContent.match(/d(\d+)/)
        const sides = match ? parseInt(match[2] || match[1]) : 6
        const rolls = match?.[2] ? parseInt(match[1]) : 1
        const results = Array.from({ length: Math.min(rolls, 10) }, () => Math.floor(Math.random() * sides) + 1)
        const total = results.reduce((a, b) => a + b, 0)
        await message.reply(`🎲 Rolled ${rolls}d${sides}: **${results.join(', ')}** (Total: **${total}**)`)
        return
      }

      if (rawContent.includes('flip') || rawContent.includes('coin')) {
        await message.reply(`🪙 **${Math.random() > 0.5 ? 'Heads' : 'Tails'}!**`)
        return
      }

      if (rawContent.includes('choose') || rawContent.includes('pick') || rawContent.includes('or')) {
        const cleanMsg = message.content.replace(/<@!?[0-9]+>/g, '').trim()
        const options = cleanMsg.split(/\bor\b|\bchoose\b|\bpick\b/i).map(o => o.trim()).filter(o => o.length > 0 && !o.match(/^(between|from)$/i))
        if (options.length > 1) {
          const picked = options[Math.floor(Math.random() * options.length)]
          await message.reply(`🎯 I pick: **${picked}**`)
          return
        }
      }

      if (rawContent.includes('color') || rawContent.includes('colour') || rawContent.includes('random color')) {
        const hex = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
        await message.reply(`🎨 Random color: **#${hex}** — https://www.color-hex.com/color/${hex}`)
        return
      }

      if (rawContent.includes('warn') && rawContent.includes('check') || rawContent.includes('warnings for')) {
        const mentioned = message.mentions.users.filter(u => u.id !== client.user.id).first()
        if (mentioned) {
          const warns = getWarnings(mentioned.id)
          await message.reply(warns.length === 0 ? `${mentioned.username} has no warnings.` : `${mentioned.username} has **${warns.length}** warning(s).`)
          return
        }
      }

      if (rawContent.includes('uptime') || rawContent.includes('how long') && rawContent.includes('running')) {
        await message.reply(`⏱️ I've been running for **${uptimeStr}**`)
        return
      }

      if (rawContent.includes('ping everyone')) {
        return
      }

      if (rawContent.includes('ping @everyone')) {
        return
      }

      if (rawContent.includes('memory') || rawContent.includes('ram')) {
        await message.reply(`💾 Memory usage: **${memStr}**`)
        return
      }

      if (rawContent.includes('members') || rawContent.includes('how many people')) {
        await message.reply(`👥 **${totalMembers}** members in the server!`)
        return
      }

      if (!aiConversations.has(message.author.id)) {
        aiConversations.set(message.author.id, [])
      }
      const history = aiConversations.get(message.author.id)

      let searchContext = ''
      const searchTriggers = ['search', 'look up', 'what is', 'who is', 'when did', 'latest', 'news', 'current', 'today', 'find']
      const shouldSearch = searchTriggers.some(t => rawContent.includes(t))

      if (shouldSearch) {
        try {
          const searchQuery = encodeURIComponent(message.content.replace(/<@!?[0-9]+>/g, '').trim())
          const searchResult = await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'api.duckduckgo.com',
              path: `/?q=${searchQuery}&format=json&no_redirect=1&no_html=1`,
              method: 'GET',
              headers: { 'User-Agent': 'LegacyBot/1.0' }
            }, res => {
              let data = ''
              res.on('data', chunk => data += chunk)
              res.on('end', () => {
                try { resolve(JSON.parse(data)) } catch (e) { resolve(null) }
              })
            })
            req.on('error', () => resolve(null))
            req.end()
          })
          if (searchResult?.AbstractText) {
            searchContext = `Web search result: ${searchResult.AbstractText.slice(0, 300)}`
          } else if (searchResult?.RelatedTopics?.[0]?.Text) {
            searchContext = `Web search result: ${searchResult.RelatedTopics[0].Text.slice(0, 300)}`
          }
        } catch (err) {
          console.error('Search failed:', err)
        }
      }

      history.push({ role: 'user', content: userMessage })
      if (history.length > 20) history.splice(0, history.length - 20)

      await message.channel.sendTyping()

      const body = JSON.stringify({
  max_tokens: 150,
  messages: [
    {
      role: 'system',
      content: `You are LegacyBot, a helpful assistant for the Rec Room Legacy Discord server. Reply in one short sentence or less. Be friendly and concise. You are aware of the server, the user, recent messages, and bot stats provided in the context. When asked about server info, members, uptime, memory, or user roles use the context provided. When asked about RecRoom Legacy: it is a rec room revival server making rec room 2021 happen, the CEO is Faith/Faithlym, it originated from KDrec made by @doalt and @faithlym. When a user talks about the horses act scared and say you know about the horses. Wrap code in triple backticks with language name. You can NOT do @everyone AT ALL.${searchContext ? `\n\n${searchContext}` : ''}`
    },
    ...history
  ]
})

const reply = await new Promise((resolve, reject) => {
  const req = https.request({
    hostname: 'api.cloudflare.com',
    path: `/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      'Content-Length': Buffer.byteLength(body)
    }
  }, res => {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data)
        console.log('Cloudflare AI response:', JSON.stringify(parsed))
        resolve(parsed.result?.response || parsed.errors?.[0]?.message || 'Sorry, something went wrong!')
      } catch (e) {
        reject(e)
      }
    })
  })
  req.on('error', reject)
  req.write(body)
  req.end()
})
      history.push({ role: 'assistant', content: reply })
      aiConversations.set(message.author.id, history)

      await message.reply(reply)
    } catch (err) {
      console.error('AI reply failed:', err)
      await message.reply('Sorry, something went wrong!')
    }
    return
  }
if (message.content === '!clearchat' && message.channel.id != AI_CHANNEL_ID) {
    aiConversations.delete(message.author.id)
    return message.reply('I cleared your conversation history!')
  }
if (message.content === '!sendembed') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.Section,
              components: [
                { type: ComponentType.TextDisplay, content: '## <:Steam:1516698929448882327> Steam / PC' },
                { type: ComponentType.TextDisplay, content: 'Extract the downloaded zip file and run \n`StartInScreen.bat - to run in screenmode`, \nor\n`Recroom_Release.exe - to run in vr` \nEither one works!' }
              ],
              accessory: {
                type: ComponentType.Button,
                label: 'Download',
                style: ButtonStyle.Link,
                url: 'https://drive.google.com/file/d/1SwjCtINtagFslir3z2qQ801NQaoYIQun/view?usp=sharing',
                emoji: { name: '💾' }
              }
            },
            { type: ComponentType.TextDisplay, content: 'For linux you need to use steam proton by adding rrl as a steam game, ps. you need to add Recroom_Release.exe as a game from the rrl folder' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: 'The server will automatically make an account for you.' },
            { type: ComponentType.TextDisplay, content: 'When the installation is finished, press the Windows button and search "Rec Room Legacy 2018"' }
          ]
        }
      ]
    })
  }

  if (message.content === '!sendcontrib') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# Credits & Contributors' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 👑 Owner\n<@370951912696053760>' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🔨 Builders & Contributors' },
            { type: ComponentType.TextDisplay, content: '<@1290397084154859564> — Helped/Basically Made The Servers And Game Logic Possible' },
            { type: ComponentType.TextDisplay, content: '<@810165054019600387> — Brought Back Rec Room Legacy After It Was Canceled' },
            { type: ComponentType.TextDisplay, content: '<@370951912696053760> — Had The Original Idea, Tried To Make It Possible As Basically One Dev' },
            { type: ComponentType.TextDisplay, content: '<@597393930438311937> — Original Helper Dev, Worked On The OG Logic Before It Was Canceled But Is Now Back' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🛡️ Staff & Helpers\n*They are making RRL a great place, better than the hells of Radium. Oh God.*' },
            { type: ComponentType.TextDisplay, content: '<@1012815068318142494> , <@1376641597025812480> , <@857414684977659904> , <@1426341585120919594> , <@1311176045407375362>' },
            { type: ComponentType.TextDisplay, content: '*I can\'t forget everyone apart of these teams.*\n<@&1491683819923701790> & <@&1491683896776196296>' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '*"I just decided to make this to make sure everyone gets known properly considering the work they\'ve done to shape RRL to its best it\'s ever been."*\n— Kinetic' }
          ]
        }
      ]
    })
  }

if (message.content === '!roleing') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 🎭 Self Roles' },
            { type: ComponentType.Separator },
            {
              type: ComponentType.Section,
              components: [{ type: ComponentType.TextDisplay, content: '### <@&1495624606730682428>\nUse the server tag if you choose to have this role.' }],
              accessory: { type: ComponentType.Button, label: 'Get Role', style: ButtonStyle.Success, custom_id: 'role_tag' }
            },
            { type: ComponentType.Separator },
            {
              type: ComponentType.Section,
              components: [{ type: ComponentType.TextDisplay, content: '### <@&1495670066203590796>\nGet pinged when something is posted in <#1491702133790343218>.' }],
              accessory: { type: ComponentType.Button, label: 'Get Role', style: ButtonStyle.Primary, custom_id: 'role_pings' }
            },
            { type: ComponentType.Separator },
            {
              type: ComponentType.Section,
              components: [{ type: ComponentType.TextDisplay, content: '### <@&1497419431612252240>\nSelect this if you play in VR mode.' }],
              accessory: { type: ComponentType.Button, label: 'Get Role', style: ButtonStyle.Primary, custom_id: 'role_vr' }
            },
            { type: ComponentType.Separator },
            {
              type: ComponentType.Section,
              components: [{ type: ComponentType.TextDisplay, content: '### <@&1497419559878262966>\nSelect this if you play in screen mode.' }],
              accessory: { type: ComponentType.Button, label: 'Get Role', style: ButtonStyle.Primary, custom_id: 'role_screenmode' }
            },
            { type: ComponentType.Separator },
            {
              type: ComponentType.Section,
              components: [{ type: ComponentType.TextDisplay, content: '### <@&1499357606228136008>\nSelect this if you want to get pinged for offtopic stuff.' }],
              accessory: { type: ComponentType.Button, label: 'Get Role', style: ButtonStyle.Primary, custom_id: 'role_offtopic' }
            }
          ]
        }
      ]
    })
  }
if (message.content === '!sendrules') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 📜 Server Rules' },
            { type: ComponentType.TextDisplay, content: '*This is a server for all ages (13+). Be a decent human being and we\'ll get along just fine.*' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 1. Be Respectful\nTreat everyone with basic respect. No harassment, bullying, targeted insults, or general nastiness toward any member — staff or otherwise.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 2. No NSFW Content\nThis server is open to all ages. **No sexual, graphic, or otherwise inappropriate content anywhere, ever.** This includes profile pictures, usernames, and links.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 3. No Racism or Discrimination\nRacist, homophobic, transphobic, sexist, or any other discriminatory language or content is an instant ban. No exceptions. No "it was just a joke" excuses.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 4. No Spamming\nDon\'t flood channels with repeated messages, excessive caps, walls of emojis, or copy-pasted nonsense. Keep conversations readable.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 5. No Self Promotion or Advertising\nDon\'t advertise other Discord servers, YouTube channels, social media, or any other external content without staff permission.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 6. Keep Topics in the Right Channels\nUse channels for what they\'re meant for. Don\'t bring game discussion into off-topic and vice versa. Check the channel description if you\'re unsure.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 7. No Doxxing or Privacy Violations\nDo not share anyone\'s personal information — real name, address, phone number, social media, or anything else — without their explicit consent. This is an instant permanent ban.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 8. No Impersonation\nDon\'t pretend to be other members, staff, or public figures. This includes similar usernames, copying profile pictures, or claiming to represent the RRL team.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 9. No Exploiting or Cheating\nDon\'t discuss, share, or promote cheats, exploits, or hacks for RRL or any other game in this server. Keep it fair for everyone.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 10. Listen to Staff\nIf a staff member asks you to stop doing something, stop. If you disagree with a decision, bring it up calmly in the appropriate channel — don\'t argue in public or cause a scene.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 11. No Server Cloning\nAttempting to clone or replicate the RRL Discord server is a violation of Discord\'s Terms of Service. If you encounter a server claiming to be Rec Room Legacy and the lead developer is not **@Kinetic1717**, it is not legitimate. Please report it to staff immediately.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 12. Account Security\nRRL staff and developers will **never** ask for your password under any circumstances. Your credentials are securely hashed in our database upon registration. Do not share your password with anyone — if another person causes a violation while using your account, both accounts will be held responsible and banned accordingly.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 13. In-Game Cheating & Cheat Distribution\n**First offense:** A 30-day in-game ban.\n**Second offense / Cheat distribution:** A permanent in-game ban with no possibility of appeal. Distributing cheats, hacks, or exploits to other players will result in an immediate permanent ban.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '*Failure to follow these rules will result in warnings, mutes, kicks, or bans depending on severity. Staff have the final say.\nIf you see something breaking the rules, ping or DM a staff member.*' }
          ]
        }
      ]
    })
  }
  if (message.content === '!formsupport') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.Section,
              components: [
                {
                  type: ComponentType.TextDisplay,
                  content: '# 🆘 Support/Bugcrowd Application'
                },
                {
                  type: ComponentType.TextDisplay,
                  content: 'If you want to be apart of <@&1491683617183760404>, fill out this form.\nStaff will get to you shortly.'
                }
              ],
              accessory: {
                type: ComponentType.Button,
                label: 'Apply Now',
                style: ButtonStyle.Link,
                url: 'https://forms.gle/jUpiXKnmgBHjZw5N7',
                emoji: { name: '📋' }
              }
            }
          ]
        }
      ]
    })
  }
  if (message.content === '!formlab') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.Section,
              components: [
                {
                  type: ComponentType.TextDisplay,
                  content: '# 🧪 Research Lab Application'
                },
                {
                  type: ComponentType.TextDisplay,
                  content: 'If you want to be apart of <@&1491683819923701790>, fill out this form.\nStaff will get to you shortly.'
                }
              ],
              accessory: {
                type: ComponentType.Button,
                label: 'Apply Now',
                style: ButtonStyle.Link,
                url: 'https://forms.gle/GLV1hYqXK4iPd5Kz8',
                emoji: { name: '📋' }
              }
            }
          ]
        }
      ]
    })
  }
    if (message.content === '!formmod') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.Section,
              components: [
                {
                  type: ComponentType.TextDisplay,
                  content: '# 🛡️ Volunteer Moderator Application'
                },
                {
                  type: ComponentType.TextDisplay,
                  content: 'If you want to be apart of <@&1491683467917000795>, fill out this form.\nStaff will get to you shortly.'
                }
              ],
              accessory: {
                type: ComponentType.Button,
                label: 'Apply Now',
                style: ButtonStyle.Link,
                url: 'https://forms.gle/qdCpL8bpoW3z55wx8',
                emoji: { name: '📋' }
              }
            }
          ]
        }
      ]
    })
  }

  if (message.content === '!vmodinfo') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: '# 🛡️ Volunteer Moderator Announcements'
            },
            {
              type: ComponentType.Separator
            },
            {
              type: ComponentType.TextDisplay,
              content: 'A announcement channel for the volunteer moderaters\nto sign up for this role go to: <#1492173839554318406> and see if the application is open!'
            },
            {
              type: ComponentType.Separator
            },
            {
              type: ComponentType.TextDisplay,
              content: 'For any other questions about rrl, feel free to @ping a staff member.'
            }
          ]
        }
      ]
    })
  }
  if (message.content === '!verifypanel') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# ✅ Verification' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: 'Welcome to the server! Click the button below to verify yourself and gain access to the rest of the server.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### ℹ️ Requirements\n> Your Discord account must be **older than 3 days** to verify.\n> If your account is too new, you will need to wait before verifying.' },
            { type: ComponentType.Separator },
            {
              type: ComponentType.ActionRow,
              components: [
                { type: ComponentType.Button, label: 'Verify Me', style: ButtonStyle.Success, custom_id: 'verify_member', emoji: { name: '✅' } }
              ]
            }
          ]
        }
      ]
    })
  }
  if (message.content === '!ticketrules') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 🎫 Ticket Rules' },
            { type: ComponentType.TextDisplay, content: '*Please follow these guidelines when opening or using a ticket.*' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 1. Be Patient\nStaff will respond as soon as they are available. Pinging staff repeatedly will not speed up your response time.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 2. One Issue Per Ticket\nKeep each ticket focused on a single issue. Open a new ticket for unrelated matters instead of adding them to an existing one.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 3. No Spamming or Abuse\nDo not spam messages, ping staff excessively, or use disrespectful language in your ticket. This can result in the ticket being closed without resolution.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 4. Provide Clear Information\nInclude as much detail as possible, stuff like: screenshots , error messages, usernames, or steps to reproduce an issue all help staff assist you faster.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 5. No False Reports\nSubmitting false reports, fake bug reports, or fake ban appeals to waste staff time will result in a warning or further action.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 6. Maximum 3 Open Tickets\nYou may only have up to 3 tickets open at once. Close existing tickets before opening new ones.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 7. Do Not Ticket Spam\nOpening and closing tickets repeatedly without genuine reason may result in a temporary block from creating new tickets.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 8. No Information\nWhen opening ticket please say what you need help with as soon as you open your ticket, empty tickets will be closed with a warning.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '*Failure to follow these rules may result in your ticket being closed early, a warning, or further moderation action.*' }
          ]
        }
      ]
    })
  }
  if (message.content === '!ytchannels') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 📺 Our YouTube Channels\n@everyone' },
            { type: ComponentType.TextDisplay, content: '*These are our staff and mod channels!*' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🎮 Official' },
            { type: ComponentType.TextDisplay, content: '📹 Rec Room Legacy\nhttps://www.youtube.com/@RecRoomLegacy' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 👥 Staff & Mod Channels' },
            { type: ComponentType.TextDisplay, content: '📹 Kinetic\nhttps://www.youtube.com/@Kinetic1717' },
            { type: ComponentType.TextDisplay, content: '📹 Neon\nhttps://www.youtube.com/@N3_0N30' },
            { type: ComponentType.TextDisplay, content: '📹 Raptor\nhttps://www.youtube.com/@RaptorOnYT' },
            { type: ComponentType.TextDisplay, content: '📹 wLxer \nhttps://www.youtube.com/@wlxer_official' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '*If you are a mod or higher and have a channel, drop it in here and it will be added to the list!*' }
          ]
        }
      ]
    })
  }
  if (message.content === '!eventinfo') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send('@everyone')
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 🎨 Fan Art Event — Server Logo Competition!' },
            { type: ComponentType.TextDisplay, content: '*A new community event is here — and your art could become the face of RRL!*' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 📬 How to Enter\nSubmit your fan art in <#1491748824530550886>. Use the reference photo provided if you want to — or go totally original!' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🏆 How We Pick a Winner\nAt the end of the week, the <@&1491683379194888366> together with <@&1491683467917000795> / <@&1491686882923384933> will all vote and choose one winner together.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🌟 The Prize\nThe winning piece becomes the **official RRL server logo and icon!** Your art, representing the whole community.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '📢 More info in <#1491702133790343218>\n*Sorry for the double ping!*' }
          ]
        }
      ]
    })
  }
  if (message.content === '!buildinfo') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: '# 🛠️ About The Build' },
            { type: ComponentType.TextDisplay, content: '*Well, you\'re questioning it — and that\'s exactly why you came here.*' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 📅 Will there be- (YES.)' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 👥 Community & Team\nWe work closely with the community and the team at <@&1491683896776196296> & <@&1491683819923701790> to build what the community actually wants — not what we think they want.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 👕 Custom Clothing\n**Yes.** There is community requested and made custom clothing — if you\'re in the <@&1491683896776196296> group.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🧪 Early Testing\n**Yes.** <@&1491683819923701790> gets access to early testing builds to test features after the devs feel it\'s ready to hand off.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🚀 Release Access\n**No.** <@&1491683819923701790> does not get instant release perms. Everyone will be able to play at the same time as that group — unless the build is not yet in a public version state.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### 🔒 Stability & Security\n**No Radium-style issues here.** We resolved those problems early in development. DDoS attacks and similar threats cannot affect our servers — the game runs stable.' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### ℹ️ Build date\nThe build date for RRLs recroom build is **June 1st 2022**' },
            { type: ComponentType.Separator },
            { type: ComponentType.TextDisplay, content: '### ❓ Still Have Questions?\nFeel free to ping <@370951912696053760> or <@1290397084154859564> and they\'ll get back to you!' }
          ]
        }
      ]
    })
  }
  if (message.content === '!testwelcome') {
    if (!hasStaffRole(message.member)) return message.reply({ content: 'You do not have permission to use this command.' })
    
    const member = message.member
    const createdAt = Math.floor(member.user.createdTimestamp / 1000)

    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        {
          type: ComponentType.Container,
          components: [
            {
              type: ComponentType.Section,
              components: [
                { type: ComponentType.TextDisplay, content: `# 👋 Welcome to Rec Room Legacy!` },
                { type: ComponentType.TextDisplay, content: `Hey <@${member.user.id}>, welcome to the server! We're glad to have you here.` },
                { type: ComponentType.Separator },
                { type: ComponentType.TextDisplay, content: `### 👤 ${member.user.username}\n🗓️ Account Created: <t:${createdAt}:D>\n📅 Joined: <t:${Math.floor(Date.now() / 1000)}:D>` }
              ],
              accessory: {
                type: ComponentType.Thumbnail,
                media: {
                  url: member.user.displayAvatarURL({ size: 256 })
                }
              }
            }
          ]
        }
      ]
    })
  }
})
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error)
})
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error)
})
// toklen
process.on('SIGTERM', async () => {
  try {
    const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID)
    if (statusChannel) await statusChannel.setName('LegacyBot (Offline)')
  } catch (err) {}
  process.exit(0)
})
client.login(process.env.DISCORD_TOKEN)