/**
 * GET  /api/community/messages?conversationId= — List messages in a conversation
 * GET  /api/community/messages?list=conversations — List user's conversations
 * POST /api/community/messages — Send a message (creates conversation if needed)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // ── GET ──
  if (req.method === 'GET') {
    const { conversationId, list } = req.query;

    // List all conversations
    if (list === 'conversations') {
      try {
        const { data, error } = await supabaseAdmin
          .from('community_conversations')
          .select('*, p1:participant_1(id, name, avatar_url), p2:participant_2(id, name, avatar_url)')
          .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
          .order('last_message_at', { ascending: false });

        if (error) throw error;

        // Get last message + unread count for each conversation
        const conversations = await Promise.all(data.map(async (c) => {
          const other = c.participant_1 === user.id ? c.p2 : c.p1;

          const { data: lastMsg } = await supabaseAdmin
            .from('community_messages')
            .select('content, created_at, sender_id')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          const { count: unread } = await supabaseAdmin
            .from('community_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', c.id)
            .neq('sender_id', user.id)
            .eq('read', false);

          return {
            id: c.id,
            otherUser: other,
            lastMessage: lastMsg ? { content: lastMsg.content, createdAt: lastMsg.created_at, isMine: lastMsg.sender_id === user.id } : null,
            unreadCount: unread || 0,
            updatedAt: c.last_message_at,
          };
        }));

        return res.status(200).json({ conversations });
      } catch (error) {
        console.error('List conversations error:', error);
        return res.status(500).json({ message: 'Failed to fetch conversations' });
      }
    }

    // List messages in a conversation
    if (conversationId) {
      try {
        // Verify user is a participant
        const { data: conv } = await supabaseAdmin
          .from('community_conversations')
          .select('participant_1, participant_2')
          .eq('id', conversationId)
          .single();

        if (!conv || (conv.participant_1 !== user.id && conv.participant_2 !== user.id)) {
          return res.status(403).json({ message: 'Not a participant' });
        }

        const { data: messages, error } = await supabaseAdmin
          .from('community_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(100);

        if (error) throw error;

        // Mark received messages as read
        await supabaseAdmin
          .from('community_messages')
          .update({ read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('read', false);

        return res.status(200).json({
          messages: messages.map(m => ({
            id: m.id,
            content: m.content,
            senderId: m.sender_id,
            isMine: m.sender_id === user.id,
            read: m.read,
            createdAt: m.created_at,
          })),
        });
      } catch (error) {
        console.error('List messages error:', error);
        return res.status(500).json({ message: 'Failed to fetch messages' });
      }
    }

    return res.status(400).json({ message: 'Provide conversationId or list=conversations' });
  }

  // ── POST: Send message ──
  if (req.method === 'POST') {
    try {
      const { recipientId, content } = req.body;

      if (!recipientId || !content) {
        return res.status(400).json({ message: 'recipientId and content are required' });
      }
      if (recipientId === user.id) {
        return res.status(400).json({ message: 'Cannot message yourself' });
      }

      // Find or create conversation (ensure consistent ordering for unique constraint)
      const p1 = user.id < recipientId ? user.id : recipientId;
      const p2 = user.id < recipientId ? recipientId : user.id;

      let { data: conv } = await supabaseAdmin
        .from('community_conversations')
        .select('id')
        .eq('participant_1', p1)
        .eq('participant_2', p2)
        .single();

      if (!conv) {
        const { data: newConv, error: convError } = await supabaseAdmin
          .from('community_conversations')
          .insert({ participant_1: p1, participant_2: p2 })
          .select()
          .single();

        if (convError) throw convError;
        conv = newConv;
      }

      // Insert message
      const { data: message, error } = await supabaseAdmin
        .from('community_messages')
        .insert({
          conversation_id: conv.id,
          sender_id: user.id,
          content,
        })
        .select()
        .single();

      if (error) throw error;

      // Create notification for recipient
      await supabaseAdmin.from('community_notifications').insert({
        user_id: recipientId,
        type: 'dm',
        actor_id: user.id,
        target_type: 'message',
        target_id: conv.id,
        message: content.substring(0, 100),
      });

      return res.status(201).json({
        message: {
          id: message.id,
          conversationId: conv.id,
          content: message.content,
          isMine: true,
          createdAt: message.created_at,
        },
      });
    } catch (error) {
      console.error('Send message error:', error);
      return res.status(500).json({ message: 'Failed to send message' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
