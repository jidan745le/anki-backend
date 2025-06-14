import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddLearningStepsToUserCards1705000000000
  implements MigrationInterface
{
  name = 'AddLearningStepsToUserCards1705000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'user_cards',
      new TableColumn({
        name: 'learningSteps',
        type: 'int',
        default: 0,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user_cards', 'learningSteps');
  }
}
