const { Events, PermissionsBitField, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const {
   URL_REGEX,
   INVITE_REGEX,
   KEYWORD_REGEX,
   PARTIAL_REGEX,
   isAdultSite,
   isWhitelistedUrl,
   isAdultInvite,
   handleViolation,
   detectBypassAttempts,
   detectSuspiciousFormatting,
   calculateSuspicionScore
} = require('../utils/helpers');
const { isSpamming, isCrossChannelSpam, detectRapidPosting } = require('../utils/spam');
const { AIPersonality } = require('../components/aiPersonality');
const { loadBlockedWordsConfig, getSeverityLevel } = require('../commands/blockedwords');
const { loadBlockedDomainsConfig, getDomainSeverity, extractDomain } = require('../commands/blockeddomains');
const { addWarning, processAutoEscalation, getUserWarnings } = require('../components/warningSystem');
const { logAction } = require('../utils/loggingSystem');
const fs = require('fs'); // Ensure fs is imported

// Initialize AI personality
const aiPersonality = new AIPersonality();

// Cleanup interval (every hour)
setInterval(() => {
   aiPersonality.cleanup();
}, 60 * 60 * 1000);

// AFK detection helper function
async function checkAFKStatus(message) {
   try {
       // Check if afkManager module exists and is properly exported
       const afkModule = require('../components/afkManager');
       let afkManager;

       if (afkModule.AFKManager) {
           afkManager = new afkModule.AFKManager();
       } else if (typeof afkModule === 'function') {
           afkManager = new afkModule();
       } else {
           // Skip AFK checking if module isn't properly set up
           return;
       }

       if (message.mentions.members.size > 0) {
           for (const [id, member] of message.mentions.members) {
               const afkStatus = afkManager.getAFKStatus(member.guild.id, id);
               if (afkStatus) {
                   await message.reply(`Psst! ${member.displayName} is currently AFK: "${afkStatus.reason}" (since ${afkStatus.time})`);
               }
           }
       }
   } catch (error) {
       // Silently skip AFK checking if there's an error - don't spam console
       console.log('[AFK] AFK system not available, skipping AFK checks');
   }
}


module.exports = {
   name: Events.MessageCreate,
   async execute(message) {
       // Ignore bot messages
       if (message.author.bot) return;

       // Ignore DMs
       if (!message.guild) return;

       // Track message for role automation
       await trackMessageForRoleAutomation(message);

       const content = message.content;
       const config = message.client.config;
       const allowedLinkChannel = config.allowed_link_channel;
       const isAdmin = message.member && message.member.permissions.has('Administrator');

       // Load blocked words and domains configs
       const blockedWordsConfig = loadBlockedWordsConfig();
       const blockedDomainsConfig = loadBlockedDomainsConfig();

       console.log(`[AUTO-MOD] Processing message from ${message.author.tag} (${message.author.id}) - Admin: ${isAdmin}: "${content.substring(0, 100)}..."`);
       console.log(`[AUTO-MOD] Config - max_mentions: ${config.max_mentions}, allowed_link_channel: ${allowedLinkChannel}`);

       // Check for AFK status
       if (!message.author.bot) {
           await checkAFKStatus(message);
       }

       // Handle custom commands
       if (!message.author.bot && message.guild) {
           const CustomCommandHandler = require('../components/customCommandHandler');
           const { loadCustomCommands } = require('../commands/customcommands');

           // Load custom commands to check for custom prefixes
           const customCommandsData = await loadCustomCommands();
           const guildCommands = customCommandsData[message.guild.id] || {};

           // Check for custom prefixes
           let commandHandled = false;
           for (const [cmdName, cmdData] of Object.entries(guildCommands)) {
               if (!cmdData.enabled || cmdData.commandType === 'slash') continue;
               
               const prefix = cmdData.prefix || '!';
               if (message.content.toLowerCase().startsWith(prefix + cmdName.toLowerCase())) {
                   const handled = await CustomCommandHandler.handleCustomCommand(message, cmdName, false);
                   if (handled) {
                       commandHandled = true;
                       break;
                   }
               }
           }

           if (commandHandled) return; // Stop processing if custom command was handled

           // Fallback to default ! prefix for backwards compatibility
           if (message.content.startsWith('!')) {
               const commandName = message.content.slice(1).split(' ')[0].toLowerCase();
               if (commandName) {
                   const handled = await CustomCommandHandler.handleCustomCommand(message, commandName, false);
                   if (handled) return; // Stop processing if custom command was handled
               }
           }
       }

       // Check for admin mention protection
       if (config.adminMentionProtection && config.adminMentionProtection.enabled) {
           // Implementation for admin mention protection would go here
           // For now, we'll just log that it's enabled.
           console.log(`[AUTO-MOD] Admin mention protection is enabled.`);
       }

       // Enhanced security analysis
       const suspicionScore = calculateSuspicionScore(content, message.author);
       const hasBypassAttempt = detectBypassAttempts(content);
       const hasSuspiciousFormatting = detectSuspiciousFormatting(content);

       console.log(`[SECURITY] User: ${message.author.tag}, Suspicion Score: ${suspicionScore}, Bypass: ${hasBypassAttempt}, Suspicious Format: ${hasSuspiciousFormatting}`);

       // Analyze message for raid patterns
       const { analyzeMessage } = require('../components/raidProtection');
       await analyzeMessage(message, message.client);


       // Check blocked words system (highest priority for non-admins)
       if (!isAdmin && blockedWordsConfig.enabled) {
           const words = content.toLowerCase().split(/\s+/);
           let blockedWordFound = null;
           let wordSeverity = 'minor';

           for (const word of words) {
               // Clean word of punctuation
               const cleanWord = word.replace(/[^\w]/g, '');

               // Skip if whitelisted
               if (blockedWordsConfig.whitelist.includes(cleanWord)) {
                   continue;
               }

               // Check if word is blocked
               if (blockedWordsConfig.blocked_words.includes(cleanWord)) {
                   blockedWordFound = cleanWord;
                   wordSeverity = getSeverityLevel(cleanWord, blockedWordsConfig);
                   break;
               }
           }

           if (blockedWordFound) {
               console.log(`[BLOCKED-WORDS] Blocked word "${blockedWordFound}" (${wordSeverity}) detected from ${message.author.tag}`);

               try {
                   // Delete message
                   await message.delete();

                   // Add warning if auto_warn is enabled
                   if (blockedWordsConfig.auto_warn) {
                       const warning = await addWarning(
                           message.guild.id,
                           message.author.id,
                           `Used blocked word: "${blockedWordFound}"`,
                           message.client.user.id,
                           wordSeverity,
                           0, // permanent warning
                           message.client
                       );

                       console.log(`✅ Auto-warning ${warning.id} issued for blocked word usage`);

                       // Process auto-escalation if enabled
                       if (blockedWordsConfig.auto_escalation) {
                           const userWarnings = getUserWarnings(message.guild.id, message.author.id);
                           const activeWarnings = userWarnings.filter(w => !w.removed && !w.expired);

                           if (activeWarnings.length >= 3) {
                               console.log(`[AUTO-ESCALATION] User ${message.author.tag} has ${activeWarnings.length} warnings, escalating to timeout`);
                               try {
                                   await message.member.timeout(24 * 60 * 60 * 1000, 'Auto-escalation: Multiple warnings');

                                   await logAction(message.guild, 'auto_escalation', {
                                       user: message.author,
                                       action: 'timeout',
                                       duration: '24 hours',
                                       reason: 'Auto-escalation: Multiple warnings',
                                       warningCount: activeWarnings.length,
                                       description: `**${message.author.tag}** auto-escalated to 24h timeout`
                                   }, message.author);
                               } catch (escalationError) {
                                   console.error(`[AUTO-ESCALATION] Failed to timeout ${message.author.tag}:`, escalationError);
                               }
                           }
                       }
                   }

                   // Send violation message
                   await message.channel.send({
                       content: `${message.author}, your message contained a blocked word and has been removed. ${blockedWordsConfig.auto_warn ? 'You have been issued a warning.' : ''}`,
                       allowedMentions: { users: [message.author.id] }
                   });

               } catch (error) {
                   console.error('❌ Error handling blocked word violation:', error);
               }
               return;
           }
       }

       // Check for blocked keywords (highest priority - always enforce)
       if (KEYWORD_REGEX.test(content) || PARTIAL_REGEX.test(content)) {
           console.log(`[AUTO-MOD] Blocked keyword detected in message from ${message.author.tag}`);
           if (!isAdmin) {
               await handleViolation(message, 'blocked_keyword', true); // Always timeout for keywords
               return;
           } else {
               console.log(`[AUTO-MOD] Admin bypass - not enforcing keyword block`);
           }
       }

       // Check for bypass attempts (non-admins only)
       if (!isAdmin && hasBypassAttempt) {
           console.log(`[SECURITY] Bypass attempt detected from ${message.author.tag}`);
           await handleViolation(message, 'bypass_attempt', true);
           return;
       }

       // Check for suspicious formatting patterns
       if (!isAdmin && hasSuspiciousFormatting) {
           console.log(`[SECURITY] Suspicious formatting detected from ${message.author.tag}`);
           await handleViolation(message, 'suspicious_formatting', suspicionScore >= 15);
           return;
       }

       // High threat detection based on suspicion score
       if (!isAdmin && suspicionScore >= 25) {
           console.log(`[SECURITY] High threat score (${suspicionScore}) detected from ${message.author.tag}`);
           await handleViolation(message, 'high_threat', true);
           return;
       }

       // New account with suspicious activity
       if (!isAdmin && message.author.createdTimestamp) {
           const accountAge = Date.now() - message.author.createdTimestamp;
           const hoursSinceCreation = accountAge / (1000 * 60 * 60);
           if (hoursSinceCreation < 24 && suspicionScore >= 15) {
               console.log(`[SECURITY] New account (${hoursSinceCreation.toFixed(1)}h old) with suspicious activity from ${message.author.tag}`);
               await handleViolation(message, 'account_too_new', true);
               return;
           }
       }

       // Check for excessive mentions
       const mentionCount = (content.match(/<@[!&]?\d+>/g) || []).length;
       if (mentionCount > config.max_mentions) {
           console.log(`[AUTO-MOD] Excessive mentions detected: ${mentionCount} from ${message.author.tag}`);
           if (!isAdmin) {
               await handleViolation(message, 'ping_spam');
               return;
           } else {
               console.log(`[AUTO-MOD] Admin bypass - not enforcing mention limit`);
           }
       }

       // Check for URLs
       const urls = content.match(URL_REGEX) || [];
       if (urls.length > 0) {
           // Check blocked domains system (for non-admins)
           if (!isAdmin && blockedDomainsConfig.enabled) {
               // Check if channel allows links
               const isAllowedChannel = blockedDomainsConfig.allowed_channels.includes(message.channel.id);

               if (!isAllowedChannel) {
                   let blockedDomainFound = null;
                   let domainSeverity = 'minor';

                   for (const url of urls) {
                       const domain = extractDomain(url);
                       if (!domain) continue;

                       // Skip if whitelisted
                       if (blockedDomainsConfig.whitelist.includes(domain)) {
                           continue;
                       }

                       // Check if domain is blocked
                       if (blockedDomainsConfig.blocked_domains.includes(domain)) {
                           blockedDomainFound = domain;
                           domainSeverity = getDomainSeverity(domain, blockedDomainsConfig);
                           break;
                       }
                   }

                   if (blockedDomainFound) {
                       console.log(`[BLOCKED-DOMAINS] Blocked domain "${blockedDomainFound}" (${domainSeverity}) detected from ${message.author.tag}`);

                       try {
                           // Delete message if configured
                           if (blockedDomainsConfig.delete_messages) {
                               await message.delete();
                           }

                           // Add warning if auto_warn is enabled
                           if (blockedDomainsConfig.auto_warn) {
                               const warning = await addWarning(
                                   message.guild.id,
                                   message.author.id,
                                   `Posted blocked domain: "${blockedDomainFound}"`,
                                   message.client.user.id,
                                   domainSeverity,
                                   0, // permanent warning
                                   message.client
                               );

                               console.log(`✅ Auto-warning ${warning.id} issued for blocked domain usage`);

                               // Process auto-escalation if enabled
                               if (blockedDomainsConfig.auto_escalation) {
                                   const userWarnings = getUserWarnings(message.guild.id, message.author.id);
                                   const activeWarnings = userWarnings.filter(w => !w.removed && !w.expired);

                                   if (activeWarnings.length >= 3) {
                                       console.log(`[AUTO-ESCALATION] User ${message.author.tag} has ${activeWarnings.length} warnings, escalating to timeout`);
                                       try {
                                           await message.member.timeout(24 * 60 * 60 * 1000, 'Auto-escalation: Multiple warnings');

                                           await logAction(message.guild, 'auto_escalation', {
                                               user: message.author,
                                               action: 'timeout',
                                               duration: '24 hours',
                                               reason: 'Auto-escalation: Multiple warnings',
                                               warningCount: activeWarnings.length,
                                               description: `**${message.author.tag}** auto-escalated to 24h timeout`
                                           }, message.author);
                                       } catch (escalationError) {
                                           console.error(`[AUTO-ESCALATION] Failed to timeout ${message.author.tag}:`, escalationError);
                                       }
                                   }
                               }
                           }

                           // Send violation message
                           await message.channel.send({
                               content: `${message.author}, your message contained a blocked domain and has been ${blockedDomainsConfig.delete_messages ? 'removed' : 'flagged'}. ${blockedDomainsConfig.auto_warn ? 'You have been issued a warning.' : ''}`,
                               allowedMentions: { users: [message.author.id] }
                           });

                       } catch (error) {
                           console.error('❌ Error handling blocked domain violation:', error);
                       }
                       return;
                   }
               }
           }

           // Check if posting in allowed channel
           if (allowedLinkChannel && message.channel.id !== allowedLinkChannel) {
               // Check for adult sites (only for non-admins)
               if (!isAdmin) {
                   for (const url of urls) {
                       if (!isWhitelistedUrl(url) && isAdultSite(url)) {
                           await handleViolation(message, 'adult_site');
                           return;
                       }
                   }
               }
           }

           // Enhanced spam checks (only for non-admins)
           const accountAge = message.author.createdTimestamp ? Date.now() - message.author.createdTimestamp : null;

           if (!isAdmin && isSpamming(message.author.id, accountAge)) {
               await handleViolation(message, 'link_spam', true);
               return;
           }

           // Check for rapid posting patterns
           if (!isAdmin && detectRapidPosting(message.author.id)) {
               console.log(`[SECURITY] Rapid posting detected from ${message.author.tag}`);
               await handleViolation(message, 'rapid_posting', true);
               return;
           }

           // Check for cross-channel spam (only for non-admins)
           if (!isAdmin && isCrossChannelSpam(message.author.id, content, message.channel.id)) {
               await handleViolation(message, 'cross_channel_spam', true);
               return;
           }
       }

       // Check for Discord invites (only for non-admins)
       if (!isAdmin) {
           const invites = content.match(INVITE_REGEX) || [];
           if (invites.length > 0) {
               for (const match of invites) {
                   const code = match.split('/').pop();
                   if (await isAdultInvite(message.client, code)) {
                       await handleViolation(message, 'adult_invite');
                       return;
                   }
               }
           }
       }

       // Process auto-reactions
       try {
           const { processAutoReactions } = require('../commands/autoreaction');
           await processAutoReactions(message);
       } catch (error) {
           console.error('❌ Error in auto-reaction handler:', error);
       }

       // Process custom messages
       try {
           const { processCustomMessages } = require('../commands/custommessages');
           await processCustomMessages(message);
       } catch (error) {
           console.error('❌ Error in custom message handler:', error);
       }

       // AI personality response
       try {
           if (aiPersonality.shouldRespond(message)) {
               // Generate AI response (which includes special topic handling)
               const response = await aiPersonality.generateResponse(message);

               // Send response if generated
               if (response) {
                   // Add typing indicator for more natural feel
                   await message.channel.sendTyping();

                   // Small delay to simulate thinking
                   setTimeout(async () => {
                       try {
                           // Ensure response isn't too long for Discord
                           const finalResponse = response.length > 2000 ? response.substring(0, 1997) + '...' : response;
                           await message.reply(finalResponse);
                       } catch (error) {
                           console.error('❌ Error sending AI response:', error);
                           // Try sending without reply if that fails
                           try {
                               await message.channel.send(finalResponse);
                           } catch (fallbackError) {
                               console.error('❌ Failed to send AI response entirely:', fallbackError);
                           }
                       }
                   }, Math.random() * 1500 + 500); // 0.5-2 second delay
               }
           }
       } catch (error) {
           console.error('❌ Error in AI personality handler:', error);
       }

       // Check for game responses
       try {
           const { loadCountingData, saveCountingData } = require('../commands/counting');
           const countingData = loadCountingData();
           if (countingData[message.guild.id] && countingData[message.guild.id][message.channel.id]) {
               await handleCountingGame(message, countingData);
           }

           // Handle word chain
           const isInWordChainChannel = message.channel.id === config.word_chain_channel_id; // Assuming config has word_chain_channel_id
           if (isInWordChainChannel) {
               const { handleWordChain } = require('../components/wordChainHandler');
               await handleWordChain(message);
           }

           // Handle game messages
           const gameHandlers = require('../components/gameHandlers');
           await gameHandlers.checkNumberGuess(message);
           await gameHandlers.checkHangmanGuess(message);
           await gameHandlers.checkWordleGuess(message);
           await gameHandlers.checkRiddleAnswer(message);

           // Experience and leveling system with much harder progression
           if (!message.author.bot && message.guild) {
               const userId = message.author.id;
               const guildId = message.guild.id;

               // Rate limiting: only give XP once every 2 minutes per user
               const lastXpKey = `${userId}_${guildId}_lastxp`;
               const lastXpTime = message.client.lastXpTimes?.get(lastXpKey) || 0;
               const now = Date.now();

               if (now - lastXpTime >= 120000) { // 2 minute cooldown (increased from 1 minute)
                   if (!message.client.lastXpTimes) message.client.lastXpTimes = new Map();
                   message.client.lastXpTimes.set(lastXpKey, now);

                   // Load user data
                   let userData = {};
                   try {
                       const userDataFile = fs.readFileSync('./config/user_data.json', 'utf8');
                       userData = JSON.parse( كانتFile);
                   } catch (error) {
                       console.log('Creating user_data.json...');
                   }

                   if (!userData[guildId]) userData[guildId] = {};
                   if (!userData[guildId][userId]) {
                       userData[guildId][userId] = { xp: 0, level: 1, messages: 0 };
                   }

                   // Much reduced XP gain (5-15 per message, significantly reduced)
                   const xpGain = Math.floor(Math.random() * 11) + 5;
                   userData[guildId][userId].xp += xpGain;
                   userData[guildId][userId].messages += 1;

                   // Much harder level calculation (exponential growth with higher base)
                   const currentLevel = userData[guildId][userId].level;
                   const requiredXP = Math.floor(500 * Math.pow(2, currentLevel - 1)); // Exponential growth with higher base

                   if (userData[guildId][userId].xp >= requiredXP) {
                       userData[guildId][userId].level += 1;
                       userData[guildId][userId].xp = 0; // Reset XP for next level

                       // Level up notification
                       try {
                           const levelUpEmbed = new EmbedBuilder()
                               .setTitle('🎉 Level Up!')
                               .setDescription(`${message.author} reached level **${userData[guildId][userId].level}**!`)
                               .addFields(
                                   { name: 'New Level', value: userData[guildId][userId].level.toString(), inline: true },
                                   { name: 'XP for Next Level', value: Math.floor(500 * Math.pow(2, userData[guildId][userId].level - 1)).toString(), inline: true }
                               )
                               .setColor('#FFD700')
                               .setThumbnail(message.author.displayAvatarURL())
                               .setTimestamp();

                           message.channel.send({ embeds: [levelUpEmbed] });
                       } catch (error) {
                           console.error('Failed to send level up message:', error);
                       }
                   }

                   // Save updated user data
                   try {
                       fs.writeFileSync('./config/user_data.json', JSON.stringify(userData, null, 2));
                   } catch (error) {
                       console.error('Failed to save user data:', error);
                   }
               }
           }


       } catch (error) {
           console.error('❌ Error in message processing:', error);
       }

       // Track social stats
       try {
           const socialModule = require('../commands/social.js');
           socialModule.trackMessage(message.guild.id, message.author.id);
       } catch (error) {
           // Social tracking is optional, don't break message processing
       }
   }
};

// Game handler functions
async function handleCountingGame(message, countingData) {
   const { saveCountingData } = require('../commands/counting');
   const { EmbedBuilder } = require('discord.js');
   const channelData = countingData[message.guild.id][message.channel.id];

   const messageNumber = parseInt(message.content.trim());

   // Check if it's a valid number
   if (isNaN(messageNumber)) {
       if (channelData.deleteWrong !== false) {
           await message.delete().catch(() => {});
       }
       return;
   }

   // Check if it's the correct number
   if (messageNumber !== channelData.currentNumber) {
       if (channelData.deleteWrong !== false) {
           await message.delete().catch(() => {});
       }

       // Add punishment tracking
       if (!channelData.punishments) channelData.punishments = {};
       if (!channelData.punishments[message.author.id]) {
           channelData.punishments[message.author.id] = 0;
       }
       channelData.punishments[message.author.id]++;

       // Send reset message
       const resetEmbed = new EmbedBuilder()
           .setTitle('💥 Counting Reset!')
           .setDescription(`❌ **${message.author}** broke the count!\n\n**Expected:** ${channelData.currentNumber}\n**Got:** ${messageNumber}\n\n**Previous highest:** ${channelData.highestReached}\n**Mistakes by this user:** ${channelData.punishments[message.author.id]}\n\n**Starting over from:** 1`)
           .setColor('#FF0000')
           .setTimestamp();

       await message.channel.send({ embeds: [resetEmbed] });

       // Reset everyone's current streaks
       Object.keys(channelData.contributors).forEach(userId => {
           channelData.contributors[userId].streak = 0;
       });

       // Reset the count
       channelData.currentNumber = 1;
       channelData.lastUser = null;
       channelData.mistakes++;
       channelData.lastResetAt = Date.now();

       saveCountingData(countingData);
       return;
   }

   // Check if same user is counting twice in a row
   if (channelData.lastUser === message.author.id) {
       if (channelData.deleteWrong !== false) {
           await message.delete().catch(() => {});
       }

       const doubleCountEmbed = new EmbedBuilder()
           .setTitle('⚠️ Double Count!')
           .setDescription(`❌ **${message.author}**, you can't count twice in a row!\n\n**Count continues from:** ${channelData.currentNumber}`)
           .setColor('#FFA500')
           .setTimestamp();

       await message.channel.send({ embeds: [doubleCountEmbed] });
       return;
   }

   // Valid count!
   channelData.currentNumber++;
   channelData.lastUser = message.author.id;
   channelData.totalMessages++;
   channelData.lastContributor = message.author.id;

   // Update highest reached
   if (channelData.currentNumber - 1 > channelData.highestReached) {
       channelData.highestReached = channelData.currentNumber - 1;
   }

   // Update contributor stats
   if (!channelData.contributors[message.author.id]) {
       channelData.contributors[message.author.id] = {
           count: 0,
           streak: 0,
           bestStreak: 0
       };
   }

   channelData.contributors[message.author.id].count++;
   channelData.contributors[message.author.id].streak++;

   if (channelData.contributors[message.author.id].streak > channelData.contributors[message.author.id].bestStreak) {
       channelData.contributors[message.author.id].bestStreak = channelData.contributors[message.author.id].streak;
   }

   const currentStreak = channelData.contributors[message.author.id].streak;

   // Add custom reactions
   const reactions = channelData.customReactions || ['✅', '🎯', '👍', '🔢', '⭐', '🎉', '💯', '🚀'];
   const reaction = reactions[Math.floor(Math.random() * reactions.length)];
   await message.react(reaction).catch(() => {});

   // Milestone notifications
   if (channelData.streakNotifications !== false) {
       const milestones = channelData.streakMilestones || [10, 25, 50, 100, 250, 500, 1000];
       const countMilestones = [100, 250, 500, 1000, 2500, 5000, 10000];

       // Streak milestones
       if (milestones.includes(currentStreak)) {
           await message.react('🏆').catch(() => {});

           let title, emoji;
           if (currentStreak === 10) { title = 'FIRE STREAK'; emoji = '🔥'; }
           else if (currentStreak === 25) { title = 'COUNTING MASTER'; emoji = '👑'; }
           else if (currentStreak === 50) { title = 'UNSTOPPABLE'; emoji = '⚡'; }
           else if (currentStreak === 100) { title = 'LEGENDARY COUNTER'; emoji = '🌟'; }
           else if (currentStreak >= 250) { title = 'COUNTING GOD'; emoji = '🚀'; }

           await message.channel.send(`${emoji} **${title}!** ${message.author} has achieved a **${currentStreak}-count streak**! ${emoji}`);
       }

       // Count milestones
       const currentCount = channelData.currentNumber - 1;
       if (countMilestones.includes(currentCount)) {
           await message.react('🎊').catch(() => {});
           await message.channel.send(`🎊 **MILESTONE REACHED!** The server has reached **${currentCount}**! 🎊\n**Contributors:** ${Object.keys(channelData.contributors).length} users`);
       }
   }

   saveCountingData(countingData);
}

async function trackMessageForRoleAutomation(message) {
    try {
        const fs = require('fs').promises;
        const path = require('path');

        const automationPath = path.join(__dirname, '../config/role_automation.json');
        let automation = {};

        try {
            const data = await fs.readFile(automationPath, 'utf8');
            automation = JSON.parse(data);
        } catch (error) {
            return;
        }

        const guildAutomation = automation[message.guild.id];
        if (!guildAutomation) return;

        // Track user message count
        const userDataPath = path.join(__dirname, '../config/user_data.json');
        let userData = {};

        try {
            const data = await fs.readFile(userDataPath, 'utf8');
            userData = JSON.parse(data);
        } catch (error) {
            userData = {};
        }

        if (!userData[message.guild.id]) userData[message.guild.id] = {};
        if (!userData[message.guild.id][message.author.id]) {
            userData[message.guild.id][message.author.id] = {
                messages: 0,
                voiceTime: 0,
                reactions: 0
            };
        }

        userData[message.guild.id][message.author.id].messages++;

        // Check automation rules
        for (const [roleId, rule] of Object.entries(guildAutomation)) {
            if (!rule.active || rule.trigger !== 'messages') continue;

            const member = message.guild.members.cache.get(message.author.id);
            if (!member || member.roles.cache.has(roleId)) continue;

            if (userData[message.guild.id][message.author.id].messages >= rule.threshold) {
                try {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role) {
                        await member.roles.add(role);

                        const embed = require('discord.js').EmbedBuilder;
                        const automationEmbed = new embed()
                            .setColor('#00FF00')
                            .setTitle('🤖 Role Automation')
                            .setDescription(`${member} has been automatically assigned the ${role} role for reaching ${rule.threshold} messages!`)
                            .setTimestamp();

                        if (message.channel.permissionsFor(message.guild.members.me).has('SendMessages')) {
                            await message.channel.send({ embeds: [automationEmbed] });
                        }
                    }
                } catch (error) {
                    console.error('Error applying automated role:', error);
                }
            }
        }

        await fs.writeFile(userDataPath, JSON.stringify(userData, null, 2));

    } catch (error) {
        console.error('Error in role automation tracking:', error);
    }
}