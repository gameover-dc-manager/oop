const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getModLogChannel } = require('./helpers');

// Load logging configuration
function loadLoggingConfig() {
    try {
        const configPath = path.join(__dirname, '../config/logging_config.json');
        if (!fs.existsSync(configPath)) {
            console.log('❌ Logging config not found, creating default config');
            return {};
        }
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error loading logging config:', error);
        return {};
    }
}

function saveLoggingConfig(config) {
    try {
        const configPath = path.join(__dirname, '../config/logging_config.json');
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error saving logging config:', error);
        return false;
    }
}

function getLoggingConfig(guildId) {
    const config = loadLoggingConfig();

    // If guild doesn't have config, create default and save it
    if (!config[guildId]) {
        const defaultConfig = {
            enabled: true,
            log_bot_messages: false,
            log_message_edits: true,
            log_message_deletes: true,
            log_member_joins: true,
            log_member_leaves: true,
            log_warnings: true,
            log_bans: true,
            log_kicks: true,
            log_timeouts: true,
            log_role_changes: true,
            log_channel_changes: true,
            log_admin_actions: true,
            ignore_admin_actions: false,
            ignore_owner_actions: false,
            log_automod_actions: true,
            log_voice_events: true,
            log_nickname_changes: true,
            log_avatar_changes: true,
            log_emoji_changes: true,
            log_sticker_changes: true,
            log_thread_events: true,
            log_invite_events: true,
            log_webhook_events: true,
            log_command_usage: true,
            log_button_interactions: false,
            log_modal_interactions: false
        };

        config[guildId] = defaultConfig;
        saveLoggingConfig(config);
        console.log(`✅ Created default logging config for guild ${guildId}`);

        return defaultConfig;
    }

    return config[guildId];
}

function updateLoggingConfig(guildId, updates) {
    const config = loadLoggingConfig();
    if (!config[guildId]) {
        config[guildId] = getLoggingConfig(guildId);
    }
    Object.assign(config[guildId], updates);
    return saveLoggingConfig(config);
}

function shouldLog(guild, actionType, user = null) {
    const config = getLoggingConfig(guild.id);

    console.log(`📝 shouldLog check: action=${actionType}, enabled=${config.enabled}, user=${user ? user.tag : 'none'}`);

    // Check if logging is enabled
    if (!config.enabled) {
        console.log(`📝 Logging disabled for guild ${guild.name}`);
        return false;
    }

    // Check if it's a bot and bot logging is disabled
    if (user && user.bot && !config.log_bot_messages) {
        console.log(`📝 Bot logging disabled, skipping ${user.tag}`);
        return false;
    }

    // Check if user is owner and owner actions should be ignored
    if (user && user.id === guild.ownerId && config.ignore_owner_actions) {
        console.log(`📝 Owner actions ignored, skipping ${user.tag}`);
        return false;
    }

    // Check if user is admin and admin actions should be ignored
    if (user && guild.members.cache.get(user.id)?.permissions.has('Administrator') && config.ignore_admin_actions) {
        console.log(`📝 Admin actions ignored, skipping ${user.tag}`);
        return false;
    }

    // Check specific action type
    const actionMap = {
        'message_edit': 'log_message_edits',
        'message_delete': 'log_message_deletes',
        'member_join': 'log_member_joins',
        'member_leave': 'log_member_leaves',
        'warning': 'log_warnings',
        'warning_added': 'log_warnings',
        'warning_removed': 'log_warnings',
        'warning_appeal': 'log_warnings',
        'ban': 'log_bans',
        'kick': 'log_kicks',
        'timeout': 'log_timeouts',
        'role_change': 'log_role_changes',
        'channel_change': 'log_channel_changes',
        'admin_action': 'log_admin_actions',
        'automod_action': 'log_automod_actions',
        'voice_join': 'log_voice_events',
        'voice_leave': 'log_voice_events',
        'voice_move': 'log_voice_events',
        'nickname_change': 'log_nickname_changes',
        'avatar_change': 'log_avatar_changes',
        'emoji_create': 'log_emoji_changes',
        'emoji_delete': 'log_emoji_changes',
        'emoji_update': 'log_emoji_changes',
        'sticker_create': 'log_sticker_changes',
        'sticker_delete': 'log_sticker_changes',
        'sticker_update': 'log_sticker_changes',
        'thread_create': 'log_thread_events',
        'thread_delete': 'log_thread_events',
        'thread_update': 'log_thread_events',
        'invite_create': 'log_invite_events',
        'invite_delete': 'log_invite_events',
        'webhook_create': 'log_webhook_events',
        'webhook_delete': 'log_webhook_events',
        'webhook_update': 'log_webhook_events',
        'command_usage': 'log_command_usage',
        'button_interaction': 'log_button_interactions',
        'modal_interaction': 'log_modal_interactions',
        'purge': 'log_message_deletes' // Assuming purge logs under message deletes
    };

    const configKey = actionMap[actionType];
    const shouldLogAction = configKey ? config[configKey] : true;

    console.log(`📝 Action type ${actionType} should log: ${shouldLogAction}`);
    return shouldLogAction;
}

async function logAction(guild, actionType, data, user = null) {
    try {
        // Enhanced validation
        if (!guild || !actionType || !data) {
            console.warn('⚠️ Missing required parameters for logAction (guild, actionType, data)');
            return false;
        }
        // User is optional, so we don't validate it here

        console.log(`📝 [LOG-ACTION] Starting: ${actionType} for guild ${guild.name || 'Unknown'} (${guild.id})`);
        console.log(`📝 [LOG-ACTION] User: ${user ? user.tag || user.username || 'Unknown' : 'N/A'}`);
        console.log(`📝 [LOG-ACTION] Data keys: ${Object.keys(data).join(', ')}`);

        // Load configuration with error handling
        let config;
        try {
            config = loadLoggingConfig(); // Use the correct function name
        } catch (configError) {
            console.error('❌ Failed to load logging config:', configError.message);
            return false;
        }

        const guildConfig = config[guild.id];
        if (!guildConfig) {
            console.log(`📝 [LOG-ACTION] No logging config for guild: ${guild.name || guild.id}`);
            return false;
        }

        // Use the existing shouldLog function which includes checks for enabled, bot messages, owner/admin ignore
        const shouldLogAction = shouldLog(guild, actionType, user);
        console.log(`📝 shouldLog check result for ${actionType}: ${shouldLogAction}`);

        if (!shouldLogAction) {
            console.log(`📝 [LOG-ACTION] Skipping log for ${actionType} in ${guild.name} (config: ${guildConfig.enabled ? 'action disabled' : 'disabled'})`);
            return false;
        }

        const logChannel = getModLogChannel(guild);
        if (!logChannel) {
            console.log(`❌ [LOG-ACTION] No log channel configured for ${guild.name} (${guild.id})`);
            return false;
        }

        console.log(`📝 [LOG-ACTION] Found log channel: ${logChannel.name} (${logChannel.id})`);

        // Check if channel is accessible
        const permissions = logChannel.permissionsFor(guild.members.me);
        if (!permissions) {
            console.log(`❌ [LOG-ACTION] Cannot get permissions for log channel ${logChannel.name}`);
            return false;
        }

        if (!permissions.has(['SendMessages', 'EmbedLinks'])) {
            console.log(`❌ [LOG-ACTION] Missing permissions in log channel ${logChannel.name}. Required: SendMessages, EmbedLinks`);
            console.log(`📝 [LOG-ACTION] Current permissions: ${permissions.toArray().join(', ')}`);
            return false;
        }

        console.log(`📝 [LOG-ACTION] Creating embed for ${actionType}`);
        let embed = createEmbedForAction(actionType, data);

        if (!embed) {
            console.log(`❌ [LOG-ACTION] Failed to create embed for ${actionType}`);
            return false;
        }

        console.log(`📝 [LOG-ACTION] Sending embed to channel ${logChannel.name}`);
        await logChannel.send({ embeds: [embed] });
        console.log(`✅ [LOG-ACTION] Successfully logged ${actionType} for ${guild.name}`);
        return true;

    } catch (error) {
        console.error(`❌ [LOG-ACTION] Error logging ${actionType} for ${guild.name || 'Unknown Guild'}:`, error.message);
        console.error(`❌ [LOG-ACTION] Stack trace:`, error.stack);
        return false;
    }
}

function createEmbedForAction(actionType, data) {
    try {
        switch (actionType) {
            case 'message_edit': return createMessageEditEmbed(data);
            case 'message_delete': return createMessageDeleteEmbed(data);
            case 'member_join': return createMemberJoinEmbed(data);
            case 'member_leave': return createMemberLeaveEmbed(data);
            case 'warning': return createWarningEmbed(data);
            case 'warning_added': return createWarningEmbed(data);
            case 'warning_removed': return createWarningRemovedEmbed(data);
            case 'warning_appeal': return createWarningAppealEmbed(data);
            case 'warning_appeal_approved': return createWarningAppealApprovedEmbed(data);
            case 'warning_appeal_denied': return createWarningAppealDeniedEmbed(data);
            case 'ban': return createBanEmbed(data);
            case 'kick': return createKickEmbed(data);
            case 'timeout': return createTimeoutEmbed(data);
            case 'role_change': return createRoleChangeEmbed(data);
            case 'channel_change': return createChannelChangeEmbed(data);
            case 'admin_action': return createAdminActionEmbed(data);
            case 'automod_action': return createAutomodActionEmbed(data);
            case 'voice_join': return createVoiceJoinEmbed(data);
            case 'voice_leave': return createVoiceLeaveEmbed(data);
            case 'voice_move': return createVoiceMoveEmbed(data);
            case 'nickname_change': return createNicknameChangeEmbed(data);
            case 'avatar_change': return createAvatarChangeEmbed(data);
            case 'emoji_create': return createEmojiCreateEmbed(data);
            case 'emoji_delete': return createEmojiDeleteEmbed(data);
            case 'emoji_update': return createEmojiUpdateEmbed(data);
            case 'sticker_create': return createStickerCreateEmbed(data);
            case 'sticker_delete': return createStickerDeleteEmbed(data);
            case 'sticker_update': return createStickerUpdateEmbed(data);
            case 'thread_create': return createThreadCreateEmbed(data);
            case 'thread_delete': return createThreadDeleteEmbed(data);
            case 'thread_update': return createThreadUpdateEmbed(data);
            case 'invite_create': return createInviteCreateEmbed(data);
            case 'invite_delete': return createInviteDeleteEmbed(data);
            case 'webhook_create': return createWebhookCreateEmbed(data);
            case 'webhook_delete': return createWebhookDeleteEmbed(data);
            case 'webhook_update': return createWebhookUpdateEmbed(data);
            case 'command_usage': return createCommandUsageEmbed(data);
            case 'button_interaction': return createButtonInteractionEmbed(data);
            case 'modal_interaction': return createModalInteractionEmbed(data);
            case 'purge': return createPurgeEmbed(data);
            default: return createGenericEmbed(actionType, data);
        }
    } catch (error) {
        console.error(`❌ [EMBED-FACTORY] Error creating embed for action "${actionType}":`, error.message);
        // Return a generic error embed
        return new EmbedBuilder()
            .setTitle(`🚨 Error Logging Action`)
            .setDescription(`An error occurred while creating the log entry for \`${actionType}\`.`)
            .addFields({ name: 'Error Details', value: `\`\`\`${error.message}\`\`\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

// Enhanced embed creation functions
function createMessageEditEmbed(data) {
    try {
        console.log(`📝 [EMBED] Creating message edit embed for ${data.author?.tag || 'unknown'}`);

        // Safely handle content with null checks
        const oldContent = data.oldContent || '';
        const newContent = data.newContent || '';

        const oldContentDisplay = oldContent.length > 0 ? 
            (oldContent.length > 800 ? oldContent.substring(0, 797) + '...' : oldContent) : 
            '*No content*';

        const newContentDisplay = newContent.length > 0 ? 
            (newContent.length > 800 ? newContent.substring(0, 797) + '...' : newContent) : 
            '*No content*';

        // Safely handle author data
        const authorTag = data.author?.tag || 'Unknown User';
        const authorId = data.author?.id || 'Unknown ID';
        const authorAvatar = data.author?.displayAvatarURL ? data.author.displayAvatarURL({ size: 64 }) : null;

        // Safely handle channel data
        const channelDisplay = data.channel?.toString() || data.channel?.name || 'Unknown Channel';

        // Create the embed
        const embed = new EmbedBuilder()
            .setTitle('✏️ Message Edited')
            .setDescription(`📍 **Channel:** ${channelDisplay}\n👤 **Author:** ${authorTag}`)
            .addFields(
                { name: '🆔 User ID', value: `\`${authorId}\``, inline: true },
                { name: '💬 Channel', value: channelDisplay, inline: true },
                { name: '🔗 Message ID', value: `\`${data.messageId || 'Unknown'}\``, inline: true },
                { name: '📊 Message Stats', value: `Before: ${oldContent.length} chars\nAfter: ${newContent.length} chars`, inline: true },
                { name: '⏰ Edit Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                { name: '🔗 Jump to Message', value: data.messageUrl ? `[Click here](${data.messageUrl})` : 'N/A', inline: true }
            )
            .setColor('#FFA500')
            .setTimestamp();

        // Add content fields if they're not too long
        if (oldContentDisplay.length < 1024) {
            embed.addFields({ name: '📝 Before', value: `\`\`\`${oldContentDisplay}\`\`\``, inline: false });
        } else {
            embed.addFields({ name: '📝 Before', value: `Content too long (${oldContent.length} chars)`, inline: false });
        }

        if (newContentDisplay.length < 1024) {
            embed.addFields({ name: '✅ After', value: `\`\`\`${newContentDisplay}\`\`\``, inline: false });
        } else {
            embed.addFields({ name: '✅ After', value: `Content too long (${newContent.length} chars)`, inline: false });
        }

        // Set thumbnail and footer safely
        if (authorAvatar) {
            embed.setThumbnail(authorAvatar);
        }

        embed.setFooter({ 
            text: `Message Edit • ID: ${data.messageId || 'Unknown'}`, 
            iconURL: authorAvatar 
        });

        console.log(`✅ [EMBED] Successfully created message edit embed`);
        return embed;

    } catch (error) {
        console.error(`❌ [EMBED] Error creating message edit embed:`, error);

        // Return a basic embed as fallback
        return new EmbedBuilder()
            .setTitle('✏️ Message Edited (Error in Formatting)')
            .setDescription(`An error occurred while formatting the message edit log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createMessageDeleteEmbed(data) {
    try {
        const content = data.content ? (data.content.length > 1000 ? data.content.substring(0, 997) + '...' : data.content) : '*No content*';
        const attachmentInfo = data.attachments > 0 ? `📎 **${data.attachments}** attachment(s)` : '';

        return new EmbedBuilder()
            .setTitle('🗑️ Message Deleted')
            .setDescription(`📍 **Channel:** ${data.channel}\n👤 **Author:** ${data.author ? data.author.tag : 'Unknown User'}`)
            .addFields(
                { name: '🆔 User ID', value: data.author ? `\`${data.author.id}\`` : 'Unknown', inline: true },
                { name: '💬 Channel', value: `${data.channel}`, inline: true },
                { name: '🔗 Message ID', value: data.messageId ? `\`${data.messageId}\`` : 'Unknown', inline: true },
                { name: '📊 Message Stats', value: `Length: ${data.content?.length || 0} chars\n${attachmentInfo}`, inline: true },
                { name: '📅 Created', value: data.createdAt ? `<t:${Math.floor(new Date(data.createdAt).getTime() / 1000)}:R>` : 'Unknown', inline: true },
                { name: '⏰ Deleted', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                { name: '📝 Content', value: `\`\`\`${content}\`\`\``, inline: false }
            )
            .setColor('#FF4444')
            .setThumbnail(data.author ? data.author.displayAvatarURL({ size: 64 }) : null)
            .setFooter({
                text: `Message Delete • ID: ${data.messageId || 'Unknown'}`,
                iconURL: data.author ? data.author.displayAvatarURL() : null
            })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating message delete embed:`, error);
        return new EmbedBuilder()
            .setTitle('🗑️ Message Deleted (Error in Formatting)')
            .setDescription(`An error occurred while formatting the message delete log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createMemberJoinEmbed(data) {
    try {
        const accountAge = Math.floor((Date.now() - data.member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        const joinPosition = data.guild ? data.guild.memberCount : 'Unknown';

        return new EmbedBuilder()
            .setTitle('👋 Member Joined')
            .setDescription(`**${data.member.user.tag}** joined the server`)
            .addFields(
                { name: '👤 User Info', value: `${data.member.user.tag}\n\`${data.member.user.id}\``, inline: true },
                { name: '📅 Account Created', value: `<t:${Math.floor(data.member.user.createdTimestamp / 1000)}:R>\n(${accountAge} days ago)`, inline: true },
                { name: '📊 Server Stats', value: `Member #${joinPosition}\nTotal: **${data.memberCount}**`, inline: true },
                { name: '🔰 Account Status', value: accountAge < 7 ? '⚠️ New Account' : accountAge < 30 ? '🔸 Young Account' : '✅ Established', inline: true },
                { name: '🎭 Default Avatar', value: data.member.user.avatar ? '❌' : '✅', inline: true },
                { name: '🤖 Bot Account', value: data.member.user.bot ? '✅' : '❌', inline: true }
            )
            .setColor('#00FF88')
            .setThumbnail(data.member.user.displayAvatarURL({ size: 128 }))
            .setFooter({ text: `Member Join • Welcome to the server!`, iconURL: data.member.user.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating member join embed:`, error);
        return new EmbedBuilder()
            .setTitle('👋 Member Joined (Error in Formatting)')
            .setDescription(`An error occurred while formatting the member join log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createMemberLeaveEmbed(data) {
    try {
        const roleList = data.roles?.length > 0 ? data.roles.map(r => `\`${r.name}\``).join(', ').substring(0, 1000) : '*No roles*';
        const timeInServer = data.member.joinedAt ? Math.floor((Date.now() - data.member.joinedTimestamp) / (1000 * 60 * 60 * 24)) : 'Unknown';

        return new EmbedBuilder()
            .setTitle('👋 Member Left')
            .setDescription(`**${data.member.user.tag}** left the server`)
            .addFields(
                { name: '👤 User Info', value: `${data.member.user.tag}\n\`${data.member.user.id}\``, inline: true },
                { name: '📅 Joined Server', value: data.member.joinedAt ? `<t:${Math.floor(data.member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                { name: '📊 Server Stats', value: `Time here: ${timeInServer} days\nRemaining: **${data.memberCount}**`, inline: true },
                { name: '🎭 Roles Count', value: `**${data.roles?.length || 0}** roles`, inline: true },
                { name: '💬 Last Activity', value: data.lastMessage ? `<t:${Math.floor(new Date(data.lastMessage).getTime() / 1000)}:R>` : 'Unknown', inline: true },
                { name: '🚪 Leave Type', value: data.kicked ? '👢 Kicked' : data.banned ? '🔨 Banned' : '🚶 Left', inline: true },
                { name: '🎭 Roles Had', value: roleList, inline: false }
            )
            .setColor('#FF4444')
            .setThumbnail(data.member.user.displayAvatarURL({ size: 128 }))
            .setFooter({ text: `Member Leave • Goodbye ${data.member.user.tag}`, iconURL: data.member.user.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating member leave embed:`, error);
        return new EmbedBuilder()
            .setTitle('👋 Member Left (Error in Formatting)')
            .setDescription(`An error occurred while formatting the member leave log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createWarningEmbed(data) {
    try {
        const severityColors = { 'minor': '#FFA500', 'major': '#FF6B35', 'severe': '#FF4444', 'critical': '#8B0000' };
        const severityEmojis = { 'minor': '⚠️', 'major': '🚨', 'severe': '🔴', 'critical': '💀' };

        const emoji = severityEmojis[data.severity] || '⚠️';
        const color = severityColors[data.severity] || '#FFA500';
        const progress = Math.min((data.totalWarnings / 5) * 100, 100);

        return new EmbedBuilder()
            .setTitle(`${emoji} Warning Issued`)
            .setDescription(`Warning issued to **${data.user.tag}**`)
            .addFields(
                { name: '👤 Target User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: `${data.moderator.tag}\n\`${data.moderator.id}\``, inline: true },
                { name: '🆔 Warning ID', value: `\`${data.warningId}\``, inline: true },
                { name: '📊 Severity Level', value: `**${data.severity.toUpperCase()}** ${emoji}`, inline: true },
                { name: '⏰ Expires', value: data.expires ? `<t:${Math.floor(data.expires / 1000)}:R>` : '**Never**', inline: true },
                { name: '📈 Warning Progress', value: `**${data.totalWarnings}/5** warnings\n${'█'.repeat(Math.floor(progress/10))}${'▒'.repeat(10-Math.floor(progress/10))} ${Math.floor(progress)}%`, inline: true },
                { name: '📝 Reason', value: `\`\`\`${data.reason.substring(0, 900)}\`\`\``, inline: false },
                { name: '⚖️ Recommended Action', value: data.totalWarnings >= 5 ? '🔨 Consider ban/kick' : data.totalWarnings >= 3 ? '🔇 Consider timeout' : '👁️ Monitor behavior', inline: false }
            )
            .setColor(color)
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Warning System • Issued by ${data.moderator.tag}`, iconURL: data.moderator.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating warning embed:`, error);
        return new EmbedBuilder()
            .setTitle('⚠️ Warning Issued (Error in Formatting)')
            .setDescription(`An error occurred while formatting the warning log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

// New embed functions for additional events
function createVoiceJoinEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🔊 Voice Channel Joined')
            .setDescription(`**${data.member.user.tag}** joined a voice channel`)
            .addFields(
                { name: '👤 User', value: `${data.member.user.tag}\n\`${data.member.user.id}\``, inline: true },
                { name: '🎤 Channel', value: `${data.channel.name}\n\`${data.channel.id}\``, inline: true },
                { name: '👥 Members in Channel', value: `**${data.channel.members.size}** members`, inline: true }
            )
            .setColor('#00FF00')
            .setThumbnail(data.member.user.displayAvatarURL())
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating voice join embed:`, error);
        return new EmbedBuilder()
            .setTitle('🔊 Voice Channel Joined (Error in Formatting)')
            .setDescription(`An error occurred while formatting the voice join log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createVoiceLeaveEmbed(data) {
    try {
        const duration = data.sessionDuration ? `${Math.floor(data.sessionDuration / 60000)} minutes` : 'Unknown';

        return new EmbedBuilder()
            .setTitle('🔇 Voice Channel Left')
            .setDescription(`**${data.member.user.tag}** left a voice channel`)
            .addFields(
                { name: '👤 User', value: `${data.member.user.tag}\n\`${data.member.user.id}\``, inline: true },
                { name: '🎤 Channel', value: `${data.channel.name}\n\`${data.channel.id}\``, inline: true },
                { name: '⏱️ Session Duration', value: duration, inline: true }
            )
            .setColor('#FF4444')
            .setThumbnail(data.member.user.displayAvatarURL())
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating voice leave embed:`, error);
        return new EmbedBuilder()
            .setTitle('🔇 Voice Channel Left (Error in Formatting)')
            .setDescription(`An error occurred while formatting the voice leave log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createCommandUsageEmbed(data) {
    let optionsText = 'None';
    if (data.options) {
        const optionsJson = JSON.stringify(data.options, null, 2);
        if (optionsJson.length > 900) {
            optionsText = `\`\`\`json\n${optionsJson.substring(0, 900)}...\n\`\`\``;
        } else {
            optionsText = `\`\`\`json\n${optionsJson}\`\`\``;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('📝 Command Used')
        .setDescription(`**Command:** \`${data.commandName}\``)
        .addFields(
            { name: '👤 User', value: `<@${data.user.id}>`, inline: true },
            { name: '📍 Channel', value: `<#${data.channelId}>`, inline: true },
            { name: '📊 Options', value: optionsText, inline: false }
        )
        .setColor('#3498db')
        .setTimestamp();

    return embed;
}

// New embed function for purge command
function createPurgeEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🗑️ Messages Purged')
            .setDescription(`📍 **Channel:** ${data.channel}\n👮 **Moderator:** ${data.moderator.tag}`)
            .addFields(
                { name: '🆔 Moderator ID', value: `\`${data.moderator.id}\``, inline: true },
                { name: '💬 Channel', value: `${data.channel}`, inline: true },
                { name: '📊 Messages Deleted', value: data.messageCount.toString(), inline: true },
                { name: '📋 Requested Limit', value: data.originalLimit.toString(), inline: true },
                { name: '⏰ Purge Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                { name: '📝 Action', value: 'Bulk message deletion', inline: true }
            )
            .setColor('#FFA500')
            .setThumbnail(data.moderator.displayAvatarURL({ size: 64 }))
            .setFooter({ text: `Purge • Channel: ${data.channel.name}` })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating purge embed:`, error);
        return new EmbedBuilder()
            .setTitle('🗑️ Messages Purged (Error in Formatting)')
            .setDescription(`An error occurred while formatting the purge log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}


// Placeholder functions for additional events (implement as needed)
function createVoiceMoveEmbed(data) { return createGenericEmbed('voice_move', data); }
function createNicknameChangeEmbed(data) { return createGenericEmbed('nickname_change', data); }
function createAvatarChangeEmbed(data) { return createGenericEmbed('avatar_change', data); }
function createEmojiCreateEmbed(data) { return createGenericEmbed('emoji_create', data); }
function createEmojiDeleteEmbed(data) { return createGenericEmbed('emoji_delete', data); }
function createEmojiUpdateEmbed(data) { return createGenericEmbed('emoji_update', data); }
function createStickerCreateEmbed(data) { return createGenericEmbed('sticker_create', data); }
function createStickerDeleteEmbed(data) { return createGenericEmbed('sticker_delete', data); }
function createStickerUpdateEmbed(data) { return createGenericEmbed('sticker_update', data); }
function createThreadCreateEmbed(data) { return createGenericEmbed('thread_create', data); }
function createThreadDeleteEmbed(data) { return createGenericEmbed('thread_delete', data); }
function createThreadUpdateEmbed(data) { return createGenericEmbed('thread_update', data); }
function createInviteCreateEmbed(data) { return createGenericEmbed('invite_create', data); }
function createInviteDeleteEmbed(data) { return createGenericEmbed('invite_delete', data); }
function createWebhookCreateEmbed(data) { return createGenericEmbed('webhook_create', data); }
function createWebhookDeleteEmbed(data) { return createGenericEmbed('webhook_delete', data); }
function createWebhookUpdateEmbed(data) { return createGenericEmbed('webhook_update', data); }
function createButtonInteractionEmbed(data) { return createGenericEmbed('button_interaction', data); }
function createModalInteractionEmbed(data) { return createGenericEmbed('modal_interaction', data); }

function createGenericEmbed(actionType, data) {
    try {
        return new EmbedBuilder()
            .setTitle(`📋 ${actionType.replace(/_/g, ' ').toUpperCase()}`)
            .setDescription(data.description || 'Action performed')
            .addFields(
                { name: '📊 Event Details', value: `\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 1000)}\`\`\``, inline: false }
            )
            .setColor('#808080')
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating generic embed for ${actionType}:`, error);
        return new EmbedBuilder()
            .setTitle(`📋 ${actionType.replace(/_/g, ' ').toUpperCase()} (Error in Formatting)`)
            .setDescription(`An error occurred while formatting the generic log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

// Continue with other required embed functions...
function createBanEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🔨 Member Banned')
            .setDescription(`**${data.user.tag}** was banned`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: data.moderator ? `${data.moderator.tag}\n\`${data.moderator.id}\``: 'Unknown', inline: true },
                { name: '🔗 User Profile', value: `[View Profile](https://discord.com/users/${data.user.id})`, inline: true },
                { name: '📝 Reason', value: `\`\`\`${data.reason || 'No reason provided'}\`\`\``, inline: false },
                { name: '🗑️ Delete Messages', value: data.deleteMessages ? `${data.deleteMessages} days` : 'None', inline: true },
                { name: '⏰ Ban Duration', value: data.duration || 'Permanent', inline: true }
            )
            .setColor('#8B0000')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Ban • Executed by ${data.moderator?.tag || 'Unknown'}`, iconURL: data.moderator?.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating ban embed:`, error);
        return new EmbedBuilder()
            .setTitle('🔨 Member Banned (Error in Formatting)')
            .setDescription(`An error occurred while formatting the ban log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createKickEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🦵 Member Kicked')
            .setDescription(`👤 **User:** ${data.user.tag}\n👮 **Moderator:** ${data.moderator.tag}`)
            .addFields(
                { name: '🆔 User ID', value: `\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator ID', value: `\`${data.moderator.id}\``, inline: true },
                { name: '📝 Reason', value: data.reason || 'No reason provided', inline: false }
            )
            .setColor('#FF8C00')
            .setThumbnail(data.user.displayAvatarURL({ size: 64 }))
            .setFooter({ text: `Kick • ID: ${data.user.id}` })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating kick embed:`, error);
        return new EmbedBuilder()
            .setTitle('🦵 Member Kicked (Error in Formatting)')
            .setDescription(`An error occurred while formatting the kick log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createTimeoutEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🔇 Member Timed Out')
            .setDescription(`**${data.user.tag}** was timed out`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: data.moderator ? `${data.moderator.tag}\n\`${data.moderator.id}\`` : 'Auto-Moderation', inline: true },
                { name: '⏱️ Duration', value: data.duration || 'Unknown', inline: true },
                { name: '📝 Reason', value: `\`\`\`${data.reason || 'No reason provided'}\`\`\``, inline: false },
                { name: '⏰ Expires', value: data.expiresAt ? `<t:${Math.floor(new Date(data.expiresAt).getTime() / 1000)}:R>` : 'Unknown', inline: true }
            )
            .setColor('#FFA500')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Timeout • Executed by ${data.moderator?.tag || 'Auto-Mod'}`, iconURL: data.moderator?.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating timeout embed:`, error);
        return new EmbedBuilder()
            .setTitle('🔇 Member Timed Out (Error in Formatting)')
            .setDescription(`An error occurred while formatting the timeout log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createRoleChangeEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('🎭 Role Updated')
            .setDescription(`Role **${data.role.name}** was ${data.action}`)
            .addFields(
                { name: '🎭 Role', value: `${data.role.name}\n\`${data.role.id}\``, inline: true },
                { name: '🔧 Action', value: data.action, inline: true },
                { name: '👮 Moderator', value: data.moderator ? `${data.moderator.tag}` : 'Unknown', inline: true },
                { name: '🎨 Color', value: data.role.hexColor, inline: true },
                { name: '📊 Position', value: `${data.role.position}`, inline: true },
                { name: '👥 Members', value: `${data.role.members?.size || 0}`, inline: true }
            )
            .setColor(data.role.color || '#9932CC')
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating role change embed:`, error);
        return new EmbedBuilder()
            .setTitle('🎭 Role Updated (Error in Formatting)')
            .setDescription(`An error occurred while formatting the role change log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createChannelChangeEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('📝 Channel Updated')
            .setDescription(`Channel **${data.channel.name}** was ${data.action}`)
            .addFields(
                { name: '📝 Channel', value: `${data.channel.name}\n\`${data.channel.id}\``, inline: true },
                { name: '🔧 Action', value: data.action, inline: true },
                { name: '👮 Moderator', value: data.moderator ? `${data.moderator.tag}` : 'Unknown', inline: true },
                { name: '📁 Type', value: data.channel.type, inline: true },
                { name: '📂 Category', value: data.channel.parent?.name || 'None', inline: true },
                { name: '👁️ Visibility', value: data.channel.viewable ? 'Visible' : 'Hidden', inline: true }
            )
            .setColor('#4169E1')
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating channel change embed:`, error);
        return new EmbedBuilder()
            .setTitle('📝 Channel Updated (Error in Formatting)')
            .setDescription(`An error occurred while formatting the channel change log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createAdminActionEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('👑 Admin Action')
            .setDescription(data.description)
            .addFields(
                { name: '👑 Admin', value: `${data.admin.tag}\n\`${data.admin.id}\``, inline: true },
                { name: '🔧 Action', value: data.action, inline: true },
                { name: '🎯 Target', value: data.target || 'N/A', inline: true },
                { name: '📝 Details', value: data.details || 'No additional details', inline: false }
            )
            .setColor('#FFD700')
            .setThumbnail(data.admin.displayAvatarURL())
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating admin action embed:`, error);
        return new EmbedBuilder()
            .setTitle('👑 Admin Action (Error in Formatting)')
            .setDescription(`An error occurred while formatting the admin action log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createAutomodActionEmbed(data) {
    try {
        const actionEmojis = { 'ban': '🔨', 'timeout': '🔇', 'kick': '🦵', 'warn': '⚠️' };
        const actionEmoji = actionEmojis[data.action] || '🤖';

        return new EmbedBuilder()
            .setTitle(`${actionEmoji} Auto-Escalation Triggered`)
            .setDescription(`**${data.action.toUpperCase()}** applied due to multiple warnings`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '⚖️ Action Taken', value: data.action.charAt(0).toUpperCase() + data.action.slice(1), inline: true },
                { name: '📊 Total Warnings', value: data.totalWarnings?.toString() || 'Unknown', inline: true },
                { name: '📝 Reason', value: data.reason, inline: false },
                { name: '🔗 User Profile', value: `[View Profile](https://discord.com/users/${data.user.id})`, inline: true },
                { name: '⏰ Applied At', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
            )
            .setColor(data.action === 'ban' ? '#8B0000' : data.action === 'timeout' ? '#FF6347' : '#FFA500')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Auto-Escalation • ${data.totalWarnings} warnings`, iconURL: data.user.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating automod action embed:`, error);
        return new EmbedBuilder()
            .setTitle('🔄 Auto-Escalation Triggered (Error in Formatting)')
            .setDescription(`An error occurred while formatting the auto-escalation log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createWarningRemovedEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('✅ Warning Removed')
            .setDescription(`Warning removed from **${data.user.tag}**`)
            .addFields(
                { name: '👤 Target User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: `${data.moderator.tag}\n\`${data.moderator.id}\``, inline: true },
                { name: '🆔 Warning ID', value: `\`${data.warningId}\``, inline: true },
                { name: '📝 Original Reason', value: `\`\`\`${data.originalReason || 'Unknown'}\`\`\``, inline: false },
                { name: '🗑️ Removal Reason', value: `\`\`\`${data.removalReason || 'No reason provided'}\`\`\``, inline: false }
            )
            .setColor('#00FF00')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Warning Removal • Removed by ${data.moderator.tag}`, iconURL: data.moderator.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating warning removed embed:`, error);
        return new EmbedBuilder()
            .setTitle('✅ Warning Removed (Error in Formatting)')
            .setDescription(`An error occurred while formatting the warning removal log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createWarningAppealEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('📝 Warning Appeal Submitted')
            .setDescription(`**${data.user.tag}** has appealed a warning`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '🆔 Warning ID', value: `\`${data.warningId}\``, inline: true },
                { name: '📊 Appeal ID', value: `\`${data.appealId}\``, inline: true },
                { name: '📝 Appeal Reason', value: `\`\`\`${data.appealReason}\`\`\``, inline: false },
                { name: '⚠️ Original Warning', value: `\`\`\`${data.originalReason || 'Unknown'}\`\`\``, inline: false },
                { name: '⏰ Appeal Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                { name: '🔍 Status', value: 'Pending Review', inline: true }
            )
            .setColor('#FFA500')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Warning Appeal • ${data.warningId}`, iconURL: data.user.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating warning appeal embed:`, error);
        return new EmbedBuilder()
            .setTitle('📝 Warning Appeal Submitted (Error in Formatting)')
            .setDescription(`An error occurred while formatting the warning appeal log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createWarningAppealApprovedEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('✅ Warning Appeal Approved')
            .setDescription(`Warning appeal has been **APPROVED**`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: `${data.moderator.tag}\n\`${data.moderator.id}\``, inline: true },
                { name: '🆔 Warning ID', value: `\`${data.warningId}\``, inline: true },
                { name: '📊 Appeal ID', value: `\`${data.appealId}\``, inline: true },
                { name: '📝 Moderator Response', value: `\`\`\`${data.moderatorResponse || 'No response provided'}\`\`\``, inline: false },
                { name: '🎯 Result', value: 'Warning Removed', inline: true },
                { name: '⏰ Decision Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
            )
            .setColor('#00FF00')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Appeal Approved • ${data.warningId}`, iconURL: data.moderator.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating warning appeal approved embed:`, error);
        return new EmbedBuilder()
            .setTitle('✅ Warning Appeal Approved (Error in Formatting)')
            .setDescription(`An error occurred while formatting the warning appeal approval log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

function createWarningAppealDeniedEmbed(data) {
    try {
        return new EmbedBuilder()
            .setTitle('❌ Warning Appeal Denied')
            .setDescription(`Warning appeal has been **DENIED**`)
            .addFields(
                { name: '👤 User', value: `${data.user.tag}\n\`${data.user.id}\``, inline: true },
                { name: '👮 Moderator', value: `${data.moderator.tag}\n\`${data.moderator.id}\``, inline: true },
                { name: '🆔 Warning ID', value: `\`${data.warningId}\``, inline: true },
                { name: '📊 Appeal ID', value: `\`${data.appealId}\``, inline: true },
                { name: '📝 Moderator Response', value: `\`\`\`${data.moderatorResponse || 'No response provided'}\`\`\``, inline: false },
                { name: '🎯 Result', value: 'Warning Upheld', inline: true },
                { name: '⏰ Decision Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
            )
            .setColor('#FF0000')
            .setThumbnail(data.user.displayAvatarURL())
            .setFooter({ text: `Appeal Denied • ${data.warningId}`, iconURL: data.moderator.displayAvatarURL() })
            .setTimestamp();
    } catch (error) {
        console.error(`❌ [EMBED] Error creating warning appeal denied embed:`, error);
        return new EmbedBuilder()
            .setTitle('❌ Warning Appeal Denied (Error in Formatting)')
            .setDescription(`An error occurred while formatting the warning appeal denial log.`)
            .addFields({ name: 'Error', value: `\`${error.message}\``, inline: false })
            .setColor('#FF0000')
            .setTimestamp();
    }
}

module.exports = {
    loadLoggingConfig,
    saveLoggingConfig,
    getLoggingConfig,
    updateLoggingConfig,
    shouldLog,
    logAction,
    createEmbedForAction,
    createMessageEditEmbed,
    createMessageDeleteEmbed,
    createMemberJoinEmbed,
    createMemberLeaveEmbed,
    createWarningEmbed,
    createWarningRemovedEmbed,
    createWarningAppealEmbed,
    createWarningAppealApprovedEmbed,
    createWarningAppealDeniedEmbed,
    createBanEmbed,
    createKickEmbed,
    createTimeoutEmbed,
    createRoleChangeEmbed,
    createChannelChangeEmbed,
    createAdminActionEmbed,
    createAutomodActionEmbed,
    createCommandUsageEmbed,
    createVoiceJoinEmbed,
    createVoiceLeaveEmbed,
    createPurgeEmbed
};