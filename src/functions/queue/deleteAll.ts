import { RabbitMQService } from "@queue/services/rabbitmq";

export const queueDeleteAll = async (rabbitMQService: RabbitMQService) => {  
  await rabbitMQService.initialize();
  await rabbitMQService.deleteAllQueues();
};
