import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ReceivingAccountsService } from './receiving-accounts.service';
import { CreateReceivingAccountDto } from './dto/create-receiving-account.dto';
import { UpdateReceivingAccountDto } from './dto/update-receiving-account.dto';

/** Administrator can: Create, Edit, Archive. */
@Controller('receiving-accounts')
export class ReceivingAccountsController {
  constructor(
    private readonly receivingAccountsService: ReceivingAccountsService,
  ) {}

  @Post()
  create(@Body() dto: CreateReceivingAccountDto) {
    return this.receivingAccountsService.create(dto);
  }

  @Get()
  findAll() {
    return this.receivingAccountsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receivingAccountsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReceivingAccountDto) {
    return this.receivingAccountsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.receivingAccountsService.remove(id);
  }
}
