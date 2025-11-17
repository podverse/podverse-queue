import { FeedService } from "podverse-orm";
import { QueueName, ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { MQFeedMessage } from "@queue/types/mq";

type QueueRSSAddAllConfig = {
  queueName: QueueName;
  priority: 'normal' | 'slow';
}

export const queueRSSAddAll = async (
  activeMQArtemisService: ActiveMQArtemisService,
  config: QueueRSSAddAllConfig
) => {
  const feedService = new FeedService();  
  const feeds = await feedService.getAll();
  
  await activeMQArtemisService.initialize();

  for (const feed of feeds) {
    const message: MQFeedMessage = {
      url: feed.url,
      podcast_index_id: feed.channel.podcast_index_id
    };

    await activeMQArtemisService.sendMessage(config.queueName, message, config.priority);
  }
};
