const { Events } = require('discord.js');
const { logAction } = require('../utils/loggingSystem');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        try {
            // Get member roles before they leave
            const roles = member.roles.cache
                .filter(role => role.name !== '@everyone')
                .map(role => ({ id: role.id, name: role.name }));

            // Log member leaving using the enhanced logging system
            await logAction(member.guild, 'member_leave', {
                member: member,
                memberCount: member.guild.memberCount,
                roles: roles
            }, member.user);

        } catch (error) {
            console.error('❌ Error processing member leave:', error);
        }
    }
};