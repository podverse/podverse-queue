import { QueueName, ActiveMQArtemisService } from "@queue/services/activeMQArtemis";

type QueueRSSAddOptions = {
  queueName: QueueName;
  feedUrl: string;
  podcastIndexId: number;
}

export const queueRSSAdd = async (
  activeMQArtemisService: ActiveMQArtemisService,
  options: QueueRSSAddOptions
) => {
  await activeMQArtemisService.initialize();

  const message = {
    url: options.feedUrl,
    podcast_index_id: options.podcastIndexId
  };

  await activeMQArtemisService.sendMessage(options.queueName, message);
};
