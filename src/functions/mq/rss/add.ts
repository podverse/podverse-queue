import { ActiveMQArtemisService } from "@queue/services/activeMQArtemis";
import { MQFeedMessage } from "@queue/types/mq";
import { MQQueueConfig } from "podverse-helpers";

type MQRSSAddOptions = MQQueueConfig & {
  feedUrl: string;
  podcast_index_id: number;
}

export const mqRSSAdd = async (
  activeMQArtemisService: ActiveMQArtemisService,
  options: MQRSSAddOptions
) => {
  await activeMQArtemisService.initialize();

  const message: MQFeedMessage = {
    url: options.feedUrl,
    podcast_index_id: options.podcast_index_id
  };

  await activeMQArtemisService.sendMessage({
    queueName: options.queueName,
    message,
    priority: options.priority,
    dedupeCacheTimeMS: options.dedupeCacheTimeMS
  });
};
