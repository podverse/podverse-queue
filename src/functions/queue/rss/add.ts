import { ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { MQFeedMessage } from "@queue/types/mq";
import { MQQueueConfig } from "podverse-helpers";

type QueueRSSAddOptions = MQQueueConfig & {
  feedUrl: string;
  podcastIndexId: number;
}

export const queueRSSAdd = async (
  activeMQArtemisService: ActiveMQArtemisService,
  options: QueueRSSAddOptions
) => {
  await activeMQArtemisService.initialize();

  const message: MQFeedMessage = {
    url: options.feedUrl,
    podcast_index_id: options.podcastIndexId
  };

  await activeMQArtemisService.sendMessage({
    queueName: options.queueName,
    message,
    priority: options.priority,
    dedupeCacheTimeMS: options.dedupeCacheTimeMS
  });
};
