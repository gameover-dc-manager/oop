const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        console.log(`👤 New member joined: ${member.user.tag} (${member.user.id})`);

        // Handle captcha verification first
        const { handleMemberJoin } = require('../components/captchaSystem');
        await handleMemberJoin(member, member.client);

        // Analyze for raid protection
        const { analyzeMemberJoin } = require('../components/raidProtection');
        await analyzeMemberJoin(member, member.client);

        const guild = member.guild;
        const config = member.client.config;

        const channelId = config.welcome_channel[guild.id];
        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return;

        const message = config.welcome_message[guild.id];
        const banner = config.welcome_banner[guild.id];

        const welcomeMessage = message
            ? message.replace(/{user}/g, member.toString()).replace(/{guild}/g, guild.name)
            : `Welcome to ${guild.name}, ${member}!`;

        const embed = new EmbedBuilder()
            .setTitle('🎉 Welcome!')
            .setDescription(welcomeMessage)
            .setColor('#00FF00')
            .setTimestamp()
            .setFooter({ text: `Member #${guild.memberCount}` });

        if (banner) {
            embed.setImage(banner);
        }

        if (member.user.displayAvatarURL()) {
            embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
        }

        try {
            await channel.send({ embeds: [embed] });

            // Log member joining using the enhanced logging system (only if not already logged by captcha system)
            if (!member._joinLogged) {
                const { logAction } = require('../utils/loggingSystem');
                await logAction(member.guild, 'member_join', {
                    member: member,
                    memberCount: member.guild.memberCount
                }, member.user);
                member._joinLogged = true;
            }

        } catch (error) {
            console.error('❌ Error in guildMemberAdd event:', error);
        }
    }
};