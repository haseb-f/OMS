-- CreateIndex
CREATE INDEX "employee_profiles_department_id_idx" ON "employee_profiles"("department_id");

-- CreateIndex
CREATE INDEX "employee_profiles_job_title_id_idx" ON "employee_profiles"("job_title_id");

-- CreateIndex
CREATE INDEX "employee_profiles_sales_team_id_idx" ON "employee_profiles"("sales_team_id");

-- CreateIndex
CREATE INDEX "employee_profiles_manager_employee_id_idx" ON "employee_profiles"("manager_employee_id");

-- CreateIndex
CREATE INDEX "leads_partner_id_idx" ON "leads"("partner_id");

-- CreateIndex
CREATE INDEX "leads_deleted_at_created_at_idx" ON "leads"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "partners_commercial_registration_idx" ON "partners"("commercial_registration");
