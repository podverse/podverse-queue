import { FeedService } from "podverse-orm";
import { ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { MQFeedMessage } from "@queue/types/mq";
import { MQQueueConfig } from "podverse-helpers";

type MQRSSAddAllConfig = MQQueueConfig;

export const mqRSSAddAll = async (
  activeMQArtemisService: ActiveMQArtemisService,
  config: MQRSSAddAllConfig
) => {
  const feedService = new FeedService();  
  const feeds = await feedService.getAll();
  
  await activeMQArtemisService.initialize();

  for (const feed of feeds) {
    const message: MQFeedMessage = {
      url: feed.url,
      podcast_index_id: feed.podcast_index_id
    };

    await activeMQArtemisService.sendMessage({
      queueName: config.queueName,
      message,
      priority: config.priority,
      dedupeCacheTimeMS: config.dedupeCacheTimeMS
    });
  }
};
