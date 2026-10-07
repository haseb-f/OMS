import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { DepartmentsModule } from '../departments/departments.module';
import { PermissionAdministrationModule } from '../permissions/permission-administration.module';

@Module({
  imports: [DepartmentsModule, PermissionAdministrationModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
