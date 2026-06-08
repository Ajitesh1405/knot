import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Runnable } from '@langchain/core/runnables';
import { GraphService } from '../graph/graph.service';
import { LlmService } from 'src/llm/llm.service';

@Injectable()
export class SearchSpecialist {
  private readonly chain: Runnable<Record<string, string>, string>;

  constructor(
    private readonly graph: GraphService,
    private readonly llm: LlmService,
  ) {
    const model = this.llm.build('fast');
    this.chain = ChatPromptTemplate.fromMessages([
      [
        'system',
        "You answer using ONLY the user's stored facts.\n" +
          '- If the user asks broadly what you know / to check memory / what you ' +
          'remember, SUMMARIZE the key facts in a few short lines.\n' +
          '- For a specific question, give a one-sentence answer from the facts.\n' +
          "- If the facts genuinely don't contain the answer, reply EXACTLY: " +
          '"I don\'t have that information yet. Tell me and I\'ll remember."',
      ],
      ['user', 'Facts:\n{facts}\n\nQuestion: {question}'],
    ])
      .pipe(model)
      .pipe(new StringOutputParser());
  }

  async run(userId: string, question: string): Promise<string> {
    const facts = await this.graph.getFactsAsText(userId);
    return this.chain.invoke({ facts, question });
  }
}
