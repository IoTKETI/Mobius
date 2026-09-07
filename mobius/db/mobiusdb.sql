-- MySQL dump 10.13  Distrib 8.0.22, for Win64 (x86_64)
--
-- Host: localhost    Database: mobiusdb
-- ------------------------------------------------------
-- Server version	8.0.22

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `acp`
--

DROP TABLE IF EXISTS `acp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pv` longtext NOT NULL,
  `pvs` longtext NOT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `acp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `acp_audit`
--
-- Change history of ACPs and acpi. No FK to lookup, so the history survives the resource's deletion.
-- Migration: migrations/007-acp-audit-table.js
--

DROP TABLE IF EXISTS `acp_audit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acp_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `ts` varchar(21) NOT NULL,
  `op` varchar(16) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ty` int unsigned NOT NULL,
  `origin` varchar(45) DEFAULT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  `before_val` text,
  `after_val` text,
  PRIMARY KEY (`id`),
  KEY `idx_acp_audit_ri` (`ri`),
  KEY `idx_acp_audit_ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ae`
--

DROP TABLE IF EXISTS `ae`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ae` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `apn` varchar(45) NOT NULL,
  `api` varchar(45) NOT NULL,
  `aei` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `poa` varchar(200) NOT NULL,
  `or` varchar(45) NOT NULL,
  `rr` varchar(45) NOT NULL,
  `nl` varchar(45) NOT NULL,
  `csz` varchar(45) DEFAULT NULL,
  `srv` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  UNIQUE KEY `aei_UNIQUE` (`aei`),
  CONSTRAINT `ae_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cb`
--

DROP TABLE IF EXISTS `cb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cb` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) NOT NULL,
  `csi` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `srt` varchar(255) NOT NULL,
  `poa` varchar(200) NOT NULL,
  `nl` varchar(45) NOT NULL,
  `ncp` varchar(45) NOT NULL,
  `srv` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  CONSTRAINT `cb_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cin`
--

DROP TABLE IF EXISTS `cin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cin` (
  `pi` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cs` int NOT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cnf` varchar(45) NOT NULL,
  `or` varchar(45) NOT NULL,
  `con` longtext NOT NULL,
  PRIMARY KEY (`ri`,`pi`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `cin_ri_idx` (`pi`,`ri`,`cs`),
  CONSTRAINT `cin_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cnt`
--

DROP TABLE IF EXISTS `cnt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cnt` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `mni` bigint unsigned NOT NULL,
  `mbs` bigint unsigned NOT NULL,
  `mia` int unsigned NOT NULL,
  `cni` bigint unsigned NOT NULL,
  `cbs` bigint unsigned NOT NULL,
  `li` varchar(45) NOT NULL,
  `or` varchar(45) NOT NULL,
  `disr` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  CONSTRAINT `cnt_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `csr`
--

DROP TABLE IF EXISTS `csr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `csr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) NOT NULL,
  `poa` varchar(200) NOT NULL,
  `cb` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `csi` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `mei` varchar(45) NOT NULL,
  `tri` varchar(45) NOT NULL,
  `rr` varchar(45) NOT NULL,
  `nl` varchar(45) NOT NULL,
  `srv` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `csr_ri_idx` (`ri`),
  CONSTRAINT `csr_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `cur_info`
--

DROP TABLE IF EXISTS `cur_info`;
/*!50001 DROP VIEW IF EXISTS `cur_info`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `cur_info` AS SELECT 
 1 AS `count(*)`,
 1 AS `sum(cs)`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `cur_info2`
--

DROP TABLE IF EXISTS `cur_info2`;
/*!50001 DROP VIEW IF EXISTS `cur_info2`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `cur_info2` AS SELECT 
 1 AS `count(*)`,
 1 AS `sum(cs)`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `cur_info3`
--

DROP TABLE IF EXISTS `cur_info3`;
/*!50001 DROP VIEW IF EXISTS `cur_info3`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `cur_info3` AS SELECT 
 1 AS `count(*)`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `fcnt`
--

DROP TABLE IF EXISTS `fcnt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fcnt` (
  `ri` varchar(200) COLLATE utf8_bin NOT NULL,
  `cnd` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `lock` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `lvl` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `curT0` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `colSn` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `powerSe` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `sus` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `red` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `green` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `blue` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `brigs` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  `cr` varchar(45) COLLATE utf8_bin DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `fcnt_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_bin COMMENT='	';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grp`
--

DROP TABLE IF EXISTS `grp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `mt` varchar(45) NOT NULL,
  `cnm` varchar(45) NOT NULL,
  `mnm` varchar(45) NOT NULL,
  `mid` mediumtext NOT NULL,
  `macp` mediumtext NOT NULL,
  `mtv` varchar(45) NOT NULL,
  `csy` varchar(45) NOT NULL,
  `gn` varchar(45) NOT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `grp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hit`
--

DROP TABLE IF EXISTS `hit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hit` (
  `ct` varchar(15) NOT NULL,
  `http` int DEFAULT NULL,
  `mqtt` int DEFAULT NULL,
  `coap` int DEFAULT NULL,
  `ws` int DEFAULT NULL,
  PRIMARY KEY (`ct`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lcp`
--

DROP TABLE IF EXISTS `lcp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lcp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `los` varchar(45) NOT NULL,
  `lou` varchar(45) NOT NULL,
  `lot` varchar(45) NOT NULL,
  `lor` varchar(45) NOT NULL,
  `loi` varchar(45) NOT NULL,
  `lon` varchar(45) NOT NULL,
  `lost` varchar(45) NOT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `lcp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lookup`
--

DROP TABLE IF EXISTS `lookup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lookup` (
  -- Identifier and name columns (pi, ri, rn, acpi, lbl, sri, spi) are utf8_bin: they compare byte for byte, so a `pi = ri` join needs no collation conversion, and paths differing only in case are distinct resources. cin.pi and sub.pi use the same collation.
  `pi` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ty` int unsigned NOT NULL,
  `ct` varchar(21) NOT NULL,
  `st` int unsigned NOT NULL,
  `rn` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `lt` varchar(45) NOT NULL,
  `et` varchar(45) NOT NULL,
  `acpi` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `lbl` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `at` varchar(45) NOT NULL,
  `aa` varchar(45) NOT NULL,
  `sri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `spi` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  -- Copies of the CIN's contentSize / contentInfo, read by discovery's sza / szb / cty. The originals are in cin; discovery filters while scanning lookup indexes, and the copies save one cin probe per candidate.
  --
  -- NULL is allowed to distinguish two cases:
  --   not a CIN            there is no contentSize; NULL is correct
  --   not yet backfilled   the value is unknown; NULL expresses that
  -- A default of 0 would be indistinguishable from a real CIN with an empty body.
  --
  -- The read path uses these columns only after the backfill is complete (migrations/012).
  `cs` int DEFAULT NULL,
  `cnf` varchar(45) DEFAULT NULL,
  -- For the discovery skeleton recursion: lets 'not a CIN (ty=4)' be asked as an equality. Inside a MySQL recursive CTE only ref (equality) access uses an index; a plain ty <> 4 would use the index up to pi and filter the rest. VIRTUAL, so it takes no row space. INVISIBLE is required so `select *` resource reads do not return not_cin in the response.
  `not_cin` tinyint unsigned GENERATED ALWAYS AS (`ty` <> 4) VIRTUAL INVISIBLE,
  PRIMARY KEY (`pi`,`ri`,`ty`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_lookup_ty` (`ty`) USING BTREE,
  -- There is no idx_lookup_ct (ct): every query that filters or sorts lookup by ct also has pi (usually ty), which idx_lookup_pi_ty_ct serves. Existing DBs are aligned by migrations/005 (INVISIBLE) -> 006 (DROP).
  -- sri is the outward resourceID and must be unique (migration 019).
  UNIQUE KEY `idx_lookup_sri_unique` (`sri`),
  KEY `idx_lookup_pi_ty_ct` (`pi`,`ty`,`ct`),
  KEY `idx_lookup_pi_notcin` (`pi`,`not_cin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mgo`
--

DROP TABLE IF EXISTS `mgo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mgo` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `mgd` varchar(45) DEFAULT NULL,
  `objs` varchar(45) DEFAULT NULL,
  `obps` varchar(45) DEFAULT NULL,
  `dc` varchar(45) DEFAULT NULL,
  `vr` varchar(45) DEFAULT NULL,
  `fwnnam` varchar(45) DEFAULT NULL,
  `url` varchar(45) DEFAULT NULL,
  `ud` varchar(45) DEFAULT NULL,
  `uds` varchar(45) DEFAULT NULL,
  `btl` varchar(45) DEFAULT NULL,
  `bts` varchar(45) DEFAULT NULL,
  `dbl` varchar(45) DEFAULT NULL,
  `man` varchar(45) DEFAULT NULL,
  `mod` varchar(45) DEFAULT NULL,
  `dty` varchar(45) DEFAULT NULL,
  `fwv` varchar(45) DEFAULT NULL,
  `swv` varchar(45) DEFAULT NULL,
  `hwv` varchar(45) DEFAULT NULL,
  `can` varchar(45) DEFAULT NULL,
  `att` varchar(45) DEFAULT NULL,
  `cas` varchar(45) DEFAULT NULL,
  `cus` varchar(45) DEFAULT NULL,
  `ena` varchar(45) DEFAULT NULL,
  `dis` varchar(45) DEFAULT NULL,
  `rbo` varchar(45) DEFAULT NULL,
  `far` varchar(45) DEFAULT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mgo_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mms`
--

DROP TABLE IF EXISTS `mms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mms` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sid` varchar(45) DEFAULT NULL,
  `soid` varchar(45) DEFAULT NULL,
  `stid` varchar(45) DEFAULT NULL,
  `asd` varchar(45) DEFAULT NULL,
  `osd` varchar(45) DEFAULT NULL,
  `sst` varchar(45) DEFAULT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mms_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `nod`
--

DROP TABLE IF EXISTS `nod`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `nod` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ni` varchar(45) NOT NULL,
  `hcl` varchar(45) DEFAULT NULL,
  `mgca` varchar(45) DEFAULT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `nod_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- The req (ty=17, <request>) table is not part of this schema; non-blocking requests (rt=1/2) are not supported. Existing deployments drop it with migrations/003-drop-req-table.js.
--

--
-- Table structure for table `schema_migrations`
--
-- Migration ledger. tools/migrate.js ensureTable creates the same table; change both together.
--
-- This file already contains the shape the migrations produce (test/schema-drift.test.js compares), so a fresh install must be 'fully applied' after the import alone, and the ledger rows below make it so: data switches such as 012 are read from this table (mobius/db_bootstrap.js readDataSwitches).
--
-- Rule: when adding a migration, (1) reflect its result in this file and (2) add its id to the INSERT below. The one exception is 010: SET PERSIST is server configuration a dump cannot carry, and autoApply runs it at first boot. test/schema-drift.test.js compares this list with migrations/, and test/mysql/schema-fresh.test.js imports the file and checks that only 010 remains.
--
-- applied_at is the date the row entered this file (the runner's format). duration_ms NULL means the migration was never run; the file already had that shape.
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `id` varchar(160) NOT NULL,
  `applied_at` varchar(21) NOT NULL,
  `duration_ms` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `schema_migrations` (`id`, `applied_at`, `duration_ms`) VALUES
('001-lookup-pi-ty-ct-index', '20260906T000000', NULL),
('002-drop-lookup-pi-index', '20260906T000000', NULL),
('003-drop-req-table', '20260906T000000', NULL),
('004-lookup-pi-notcin-index', '20260906T000000', NULL),
('005-lookup-ct-index-invisible', '20260906T000000', NULL),
('006-drop-lookup-ct-index', '20260906T000000', NULL),
('007-acp-audit-table', '20260906T000000', NULL),
('008-drop-tm-tr-tables', '20260906T000000', NULL),
('009-widen-cb-srt', '20260906T000000', NULL),
('011-lookup-cin-attrs', '20260906T000000', NULL),
('012-lookup-cin-attrs-filled', '20260906T000000', NULL),
('013-sub-pi-index', '20260906T000000', NULL),
('014-sub-widen-nu-enc', '20260906T000000', NULL),
('015-drop-lookup-subl', '20260906T000000', NULL),
('016-drop-orphan-csr-lookup', '20260906T000000', NULL),
('017-dedupe-lookup-sri', '20260906T000000', NULL),
('018-id-columns-collation-bin', '20260906T000000', NULL),
('019-lookup-sri-unique', '20260906T000000', NULL);

--
-- Table structure for table `smd`
--

DROP TABLE IF EXISTS `smd`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `smd` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  `dsp` longtext,
  `or` mediumtext,
  `soe` varchar(200) DEFAULT NULL,
  `rels` varchar(400) DEFAULT NULL,
  `dcrp` longtext,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `sd_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sri`
--

DROP TABLE IF EXISTS `sri`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sri` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sri` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  PRIMARY KEY (`ri`,`sri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_sri_sri` (`sri`),
  CONSTRAINT `sri_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sub`
--

DROP TABLE IF EXISTS `sub`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pi` varchar(400) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  `enc` text,
  `exc` varchar(45) DEFAULT NULL,
  `nu` text,
  `gpi` varchar(45) DEFAULT NULL,
  `nfu` varchar(45) DEFAULT NULL,
  `bn` varchar(45) DEFAULT NULL,
  `rl` varchar(45) DEFAULT NULL,
  `psn` varchar(45) DEFAULT NULL,
  `pn` varchar(45) DEFAULT NULL,
  `nsp` varchar(45) DEFAULT NULL,
  `ln` varchar(45) DEFAULT NULL,
  `nct` varchar(45) DEFAULT NULL,
  `nec` varchar(45) DEFAULT NULL,
  `cr` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin DEFAULT NULL,
  `su` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  KEY `idx_sub_pi` (`pi`),
  CONSTRAINT `sub_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- The tm (ty=38, <transactionMgmt>) / tr (ty=39, <transaction>) tables are not part of this schema; the oneM2M distributed transaction (two-phase commit) is not supported. Existing deployments drop them with migrations/008-drop-tm-tr-tables.js.
--

--
-- Final view structure for view `cur_info`
--

/*!50001 DROP VIEW IF EXISTS `cur_info`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `cur_info` AS select count(0) AS `count(*)`,sum(`cin`.`cs`) AS `sum(cs)` from `cin` where (`cin`.`pi` = '/Mobius/ae-edu1/cnt-co2') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `cur_info2`
--

/*!50001 DROP VIEW IF EXISTS `cur_info2`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `cur_info2` AS select count(0) AS `count(*)`,sum(`cin`.`cs`) AS `sum(cs)` from `cin` where (`cin`.`pi` = '/Mobius/UTM_01/GCS_Data') */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `cur_info3`
--

/*!50001 DROP VIEW IF EXISTS `cur_info3`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `cur_info3` AS select count(0) AS `count(*)` from `lookup` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2020-11-05  0:01:36
