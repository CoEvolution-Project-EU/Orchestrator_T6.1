import { Kafka } from 'kafkajs' ;


const kafka = new Kafka({
  clientId: 'orchestrator',
  brokers: [process.env.KAFKA_BROKER || '147.102.19.168:30004'],
})

const producer = kafka.producer()

export async function initKafka() {
    try {
      await producer.connect()
      console.log('Kafka producer connected')
    } catch (error) {
      console.log('Kafka connection failed:', error.message)
      // don't crash the server if Kafka is unavailable
    }
  }