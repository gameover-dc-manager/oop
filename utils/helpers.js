const { EmbedBuilder } = require('discord.js');
const { URL } = require('url');
// Remove circular dependency - sendAppealButtonToUser is now available globally

// Adult site domains
const ADULT_DOMAINS = new Set([
    'onlyfans.com',
    'bangbros.com',
    'adultfriendfinder.com',
    'cams.com'
]);

// Enhanced blocked words with bypass variations
const BLOCKED_WORDS = [
    "porn", "pornography", "xxx", "nude", "naked", "hardcore", "erotic", "erotica",
    "fetish", "bdsm", "bondage", "threesome", "orgy", "cum", "cock", "dick",
    "pussy", "vagina", "penis", "anal", "blowjob", "handjob", "tit", "tits",
    "boobs", "ass", "butt", "creampie", "slut", "whore", "cumshot", "masturbate", "masturbation",
    "nsfw", "18+", "adult", "mature", "x-rated", "r-rated", "softcore", "semi-nude",
    "undressing", "strip", "undressed", "topless", "bottomless", "bare", "nudity",
    "sensorial", "intimate", "sexual", "sensual", "sex", "onlyfans", "chaturbate",
    "xvideos", "pornhub", "brazzers", "milf", "dildo", "vibrator", "escort",
    "camgirl", "camboy", "webcam", "livecam", "sexchat", "cybersex", "sextoy"
];

// Enhanced bypass detection patterns
const BYPASS_PATTERNS = [
    /p[o0*@][r*][n*]/gi,
    /s[e3*@][x*]/gi,
    /n[u*@][d*][e3*@]/gi,
    /[a@4][s$5][s$5]/gi,
    /d[i1*@][c*k]/gi,
    /p[u*@][s$5][s$5][y*]/gi,
    /t[i1*@][t+]/gi,
    /f[u*@][c*k]/gi,
    /b[i1*@][t+][c*h]/gi,
    /[w*][h*][o0*][r*][e3*]/gi
];

// Zero-width character detection
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g;

// Excessive formatting detection
const FORMATTING_SPAM = /(\*{3,}|_{3,}|`{3,}|~{3,})/g;

const half = Math.floor(BLOCKED_WORDS.length / 2);
const EXPLICIT = BLOCKED_WORDS.slice(0, half);
const PARTIAL = BLOCKED_WORDS.slice(half);

// Regex patterns
const URL_REGEX = /(https?:\/\/\S+|www\.\S+)/gi;
const INVITE_REGEX = /(?:https?:\/\/)?(?:canary\.|ptb\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([A-Za-z0-9\-]+)/gi;
const KEYWORD_REGEX = new RegExp(`\\b(${EXPLICIT.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
const PARTIAL_REGEX = new RegExp(`\\b(${PARTIAL.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

// Enhanced content analysis functions
function normalizeText(text) {
    return text
        .replace(ZERO_WIDTH_CHARS, '') // Remove zero-width characters
        .replace(/[^\w\s]/g, '') // Remove special characters except word chars and spaces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .toLowerCase()
        .trim();
}

function detectBypassAttempts(text) {
    const normalized = normalizeText(text);

    // Only check for obvious bypass patterns - be less aggressive
    const obviousBypassPatterns = [
        /p[o0*@][r*][n*]/gi,
        /s[e3*@][x*]/gi,
        /f[u*@][c*k]/gi
    ];

    // Check for obvious bypass patterns only
    for (const pattern of obviousBypassPatterns) {
        if (pattern.test(normalized)) {
            return true;
        }
    }

    // Check for character substitution bypasses with stricter criteria
    const substitutionThreshold = 3; // Require at least 3 substitutions to be suspicious
    let substitutionCount = 0;

    for (const word of BLOCKED_WORDS) {
        if (word.length < 4) continue; // Skip short words to reduce false positives
        
        let pattern = word;
        const commonSubstitutions = {
            'a': '[a@4]',
            'e': '[e3]',
            'i': '[i1]',
            'o': '[o0]',
            's': '[s$5]'
        };

        for (const [char, substitute] of Object.entries(commonSubstitutions)) {
            if (pattern.includes(char)) {
                pattern = pattern.replace(new RegExp(char, 'g'), substitute);
                substitutionCount++;
            }
        }

        if (substitutionCount >= substitutionThreshold) {
            const regex = new RegExp(pattern, 'gi');
            if (regex.test(normalized)) {
                return true;
            }
        }
        substitutionCount = 0;
    }

    return false;
}

function detectSuspiciousFormatting(text) {
    // Check for excessive formatting (spam technique)
    if (FORMATTING_SPAM.test(text)) {
        return true;
    }

    // Check for suspicious spacing patterns
    const spacingPattern = /\w\s{3,}\w/g;
    if (spacingPattern.test(text)) {
        return true;
    }

    // Check for mixed scripts (potential obfuscation)
    const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (cyrillicCount > 0 && latinCount > 0 && text.length < 50) {
        return true;
    }

    return false;
}

function calculateSuspicionScore(text, author) {
    let score = 0;

    // Base content checks - more conservative scoring
    if (KEYWORD_REGEX.test(text)) score += 20; // Increase for actual blocked keywords
    if (PARTIAL_REGEX.test(text)) score += 8;
    if (detectBypassAttempts(text)) score += 25; // High score for actual bypass attempts
    if (detectSuspiciousFormatting(text)) score += 12;

    // URL density check - be more lenient
    const urls = text.match(URL_REGEX) || [];
    if (urls.length > 5) score += 8; // Increased threshold
    if (urls.length > 2 && text.length < 50) score += 5; // Stricter length requirement

    // Excessive caps - be more lenient with short messages
    if (text.length > 20) {
        const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
        if (capsRatio > 0.8) score += 6;
    }

    // Repetitive characters - ignore common patterns
    const repeatingPattern = /(.)\1{6,}/g; // Increased threshold
    if (repeatingPattern.test(text) && !/[.!?]{3,}/.test(text)) score += 4; // Ignore punctuation repetition

    // Account age factor - more balanced
    if (author && author.createdTimestamp) {
        const accountAge = Date.now() - author.createdTimestamp;
        const daysSinceCreation = accountAge / (1000 * 60 * 60 * 24);
        if (daysSinceCreation < 3) score += 8; // Only very new accounts
        if (daysSinceCreation < 0.5) score += 15; // Less than 12 hours old
    }

    // Reduce score for normal conversational patterns
    if (text.length > 10 && text.includes(' ') && !text.includes('http')) {
        score = Math.max(0, score - 3); // Slight reduction for normal text
    }

    return score;
}

function getModLogChannel(guild) {
    const fs = require('fs');
    const path = require('path');

    try {
        const logConfigPath = path.join(__dirname, '../config/log_channels.json');
        if (!fs.existsSync(logConfigPath)) {
            console.log(`❌ Log channels config not found at: ${logConfigPath}`);
            return null;
        }

        const logConfig = JSON.parse(fs.readFileSync(logConfigPath, 'utf8'));
        const channelId = logConfig[guild.id];

        console.log(`🔍 Looking for log channel for guild ${guild.name} (${guild.id}): ${channelId}`);

        if (channelId) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
                console.log(`✅ Found log channel: ${channel.name} (${channel.id})`);
                return channel;
            } else {
                console.log(`❌ Log channel not found with ID: ${channelId}`);
            }
        } else {
            console.log(`❌ No log channel configured for guild: ${guild.name} (${guild.id})`);
        }
    } catch (error) {
        console.error('❌ Error loading log channels config:', error);
    }

    return null;
}

function domainOf(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase();
    } catch {
        return '';
    }
}

function isAdultSite(url) {
    const domain = domainOf(url);
    return Array.from(ADULT_DOMAINS).some(bad => 
        domain === bad || domain.endsWith(`.${bad}`)
    );
}

function isWhitelistedUrl(url) {
    try {
        const parsed = new URL(url);
        const domain = parsed.hostname.toLowerCase();
        return (
            domain.endsWith('youtube.com') ||
            domain === 'youtu.be' ||
            domain === 'media.discordapp.net' ||
            domain === 'cdn.discordapp.com' ||
            domain.includes('tenor.com')
        );
    } catch {
        return false;
    }
}

async function isAdultInvite(client, code) {
    try {
        const invite = await client.fetchInvite(code);
        if (invite.guild) {
            const guild = invite.guild;
            // Check if any channels are NSFW
            const channels = await guild.channels.fetch();
            for (const [id, channel] of channels) {
                if (channel.nsfw) {
                    return true;
                }
            }
        }
        return false;
    } catch {
        return true; // Assume adult if we can't fetch
    }
}

async function handleViolation(message, violation, autoTimeout = false) {
    console.log(`[AUTO-MOD] Handling violation: ${violation} for ${message.author.tag}`);

    // Enhanced logging for security analysis
    const suspicionScore = calculateSuspicionScore(message.content, message.author);
    console.log(`[SECURITY] Suspicion score: ${suspicionScore} for ${message.author.tag}`);

    // Try to delete message with improved error handling
    try {
        await message.delete();
        console.log(`[AUTO-MOD] Deleted message from ${message.author.tag}`);
    } catch (error) {
        if (error.code === 10008) {
            console.log(`[AUTO-MOD] Message already deleted (${message.author.tag})`);
        } else {
            console.error(`[AUTO-MOD] Error deleting message from ${message.author.tag}:`, error);
        }
    }

    const author = message.author;
    const reasonText = global.VIOLATION_REASONS[violation] || violation.replace('_', ' ');

    // Enhanced threat assessment
    const isHighThreat = suspicionScore >= 20 || violation === 'blocked_keyword' || violation === 'bypass_attempt';

    // Escalate punishment for high-threat users
    if (isHighThreat) {
        autoTimeout = true;
        console.log(`[SECURITY] High threat detected - escalating to auto-timeout for ${author.tag}`);
    }

    if (autoTimeout) {
        const timeoutDuration = global.SPAM_TIMEOUT_DURATION || 10 * 60 * 1000; // Default 10 minutes
        console.log(`[AUTO-MOD] Attempting to timeout ${message.author.tag} for ${timeoutDuration / 60000} minutes`);

        // Check if bot has permission to timeout members
        const botMember = message.guild.members.me;
        if (!botMember || !botMember.permissions.has('ModerateMembers')) {
            console.error(`[AUTO-MOD] Bot lacks permission to timeout members in ${message.guild.name}`);
            
            // Log that the action would have been taken but permissions are missing
            try {
                const { logAction } = require('./loggingSystem');
                await logAction(message.guild, 'automod_action', {
                    user: message.author,
                    action: 'Timeout (Failed - No Permission)',
                    reason: `Auto-moderation: ${violation} - Bot lacks timeout permissions`,
                    channel: message.channel
                }, message.author);
            } catch (logError) {
                console.error('❌ Error logging failed automod action:', logError);
            }
            
            // Send warning instead
            try {
                const warningMessage = `⚠️ ${author}, ${reasonText} detected. **Warning issued** (automatic timeout failed - insufficient permissions).`;
                await message.channel.send(warningMessage);
            } catch (error) {
                console.error(`[AUTO-MOD] Error sending warning message:`, error);
            }
            return;
        }

        try {
            await message.member.timeout(timeoutDuration, `Auto-moderation: ${violation}`);
            console.log(`✅ Applied timeout to ${message.author.tag} for ${violation}`);

            // Log the automod action
            try {
                const { logAction } = require('./loggingSystem');
                await logAction(message.guild, 'automod_action', {
                    user: message.author,
                    action: 'Timeout',
                    reason: `Auto-moderation: ${violation}`,
                    duration: `${timeoutDuration / 60000} minutes`,
                    channel: message.channel
                }, message.author);
            } catch (logError) {
                console.error('❌ Error logging automod action:', logError);
            }
        } catch (error) {
            console.error(`[AUTO-MOD] Error timing out ${message.author.tag}:`, error);
            
            // Send warning instead if timeout fails
            try {
                const warningMessage = `⚠️ ${author}, ${reasonText} detected. **Warning issued** (automatic timeout failed).`;
                await message.channel.send(warningMessage);
            } catch (fallbackError) {
                console.error(`[AUTO-MOD] Error sending fallback warning:`, fallbackError);
            }
        }

        // Send appeal button notification
        try {
            const { sendTimeoutAppealButton } = require('./appealNotification');
            const success = await sendTimeoutAppealButton(author, message.guild.id, violation, message.client);
            if (success) {
                console.log(`[AUTO-MOD] Successfully sent appeal button to ${message.author.tag}`);
            } else {
                console.log(`[AUTO-MOD] Failed to send appeal button to ${message.author.tag} - likely DMs disabled`);
            }
        } catch (error) {
            console.error(`[AUTO-MOD] Error sending appeal button to ${message.author.tag}:`, error);

            // Fallback: Try to notify in the log channel that the appeal button couldn't be sent
            const logChannel = getModLogChannel(message.guild);
            if (logChannel) {
                try {
                    await logChannel.send({
                        content: `⚠️ **Failed to send appeal button to ${author.tag}**\n` +
                                `Reason: ${error.message}\n` +
                                `User ID: ${author.id}\n` +
                                `This usually means the user has DMs disabled or has blocked the bot.`
                    });
                } catch (logError) {
                    console.error('Failed to log appeal button error:', logError);
                }
            }
        }

        // Log timeout using enhanced logging system
        try {
            const { logAction } = require('./loggingSystem');
            await logAction(message.guild, 'automod_action', {
                user: author,
                action: 'timeout',
                reason: reasonText,
                duration: `${timeoutDuration / 60000} minutes`,
                channel: message.channel
            }, author);
        } catch (error) {
            console.error(`[AUTO-MOD] Error logging timeout:`, error);
        }

        // Create and send timeout notification embed
        try {
            const { EmbedBuilder } = require('discord.js');
            const timeoutEmbed = new EmbedBuilder()
                .setTitle('🔇 Auto-Moderation Action')
                .setDescription(`${author} has been timed out for ${timeoutDuration / 60000} minutes`)
                .addFields(
                    { name: 'Reason', value: reasonText, inline: true },
                    { name: 'Duration', value: `${timeoutDuration / 60000} minutes`, inline: true }
                )
                .setColor('#FF6B35')
                .setTimestamp();

            await message.channel.send({ embeds: [timeoutEmbed] });
        } catch (error) {
            console.error(`[AUTO-MOD] Error sending timeout message to channel:`, error);
        }
    } else {
        // First offense warning
        const warningMessage = `${author}, ${reasonText} detected. Further violations will result in a timeout.`;
        try {
            await message.channel.send(warningMessage);
            console.log(`[AUTO-MOD] Sent warning to ${message.author.tag}: ${reasonText}`);
        } catch (error) {
            console.error(`[AUTO-MOD] Error sending warning message:`, error);
        }

        // Log warning using enhanced logging system
        try {
            const { logAction } = require('./loggingSystem');
            await logAction(message.guild, 'automod_action', {
                user: author,
                action: 'warning',
                reason: reasonText,
                channel: message.channel,
                messageContent: message.content.substring(0, 500)
            }, author);
        } catch (error) {
            console.error(`[AUTO-MOD] Error logging warning:`, error);
        }
    }
}

// Add new violation types
global.VIOLATION_REASONS = {
    ...global.VIOLATION_REASONS,
    'bypass_attempt': 'attempting to bypass word filters',
    'suspicious_formatting': 'suspicious text formatting patterns',
    'high_threat': 'high threat content detected',
    'rapid_posting': 'posting messages too rapidly',
    'account_too_new': 'new account suspicious activity'
};

module.exports = {
    URL_REGEX,
    INVITE_REGEX,
    KEYWORD_REGEX,
    PARTIAL_REGEX,
    ADULT_DOMAINS,
    BLOCKED_WORDS,
    EXPLICIT,
    PARTIAL,
    BYPASS_PATTERNS,
    getModLogChannel,
    domainOf,
    isAdultSite,
    isWhitelistedUrl,
    isAdultInvite,
    handleViolation,
    normalizeText,
    detectBypassAttempts,
    detectSuspiciousFormatting,
    calculateSuspicionScore
};