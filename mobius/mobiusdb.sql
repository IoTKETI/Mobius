-- MySQL dump 10.13  Distrib 5.7.17, for macos10.12 (x86_64)
--
-- Host: 127.0.0.1    Database: mobiusdb
-- ------------------------------------------------------
-- Server version	5.5.5-10.2.12-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
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
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `acp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pv` longtext DEFAULT NULL,
  `pvs` longtext DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `acp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `acp`
--

LOCK TABLES `acp` WRITE;
/*!40000 ALTER TABLE `acp` DISABLE KEYS */;
INSERT INTO `acp` VALUES ('/Mobius/acp-justin','{\"acr\":[{\"acor\":[\"justin\"],\"acop\":\"63\"}]}','{\"acr\":[{\"acor\":[\"justin\"],\"acop\":\"63\"}]}');
/*!40000 ALTER TABLE `acp` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ae`
--

DROP TABLE IF EXISTS `ae`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ae` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `apn` varchar(45) DEFAULT NULL,
  `api` varchar(45) DEFAULT NULL,
  `aei` varchar(200) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `rr` varchar(45) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  `csz` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  UNIQUE KEY `aei_UNIQUE` (`aei`),
  CONSTRAINT `ae_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ae`
--

LOCK TABLES `ae` WRITE;
/*!40000 ALTER TABLE `ae` DISABLE KEYS */;
INSERT INTO `ae` VALUES ('/Mobius/ae_test2','','0.2.481.2.0001.001.000111','S20180221054413068HDUn','[]','','true','',''),('/Mobius/edu4','','measure_co2','Sedu4','[]','','true','',''),('/Mobius/flavia','','0.2.481.2.0001.001.000111','S201803080854241479wjB','[]','','true','','');
/*!40000 ALTER TABLE `ae` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cb`
--

DROP TABLE IF EXISTS `cb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cb` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) DEFAULT NULL,
  `csi` varchar(45) DEFAULT NULL,
  `srt` varchar(100) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  `ncp` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  CONSTRAINT `cb_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cb`
--

LOCK TABLES `cb` WRITE;
/*!40000 ALTER TABLE `cb` DISABLE KEYS */;
INSERT INTO `cb` VALUES ('/Mobius','1','/Mobius','[\"1\",\"2\",\"3\",\"4\",\"5\",\"9\",\"10\",\"13\",\"14\",\"16\",\"17\",\"23\",\"24\",\"27\",\"29\",\"30\",\"38\",\"39\"]','[\"http://192.168.0.104:7579\",\"mqtt://192.168.0.104:1883/Mobius\",\"coap://192.168.0.104:7579\",\"ws://192.168.0.104:7577\"]','','');
/*!40000 ALTER TABLE `cb` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cin`
--

DROP TABLE IF EXISTS `cin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cin` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `cnf` varchar(45) DEFAULT NULL,
  `cs` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `con` longtext DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `cin_ri_idx` (`ri`),
  CONSTRAINT `cin_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cin`
--

LOCK TABLES `cin` WRITE;
/*!40000 ALTER TABLE `cin` DISABLE KEYS */;
INSERT INTO `cin` VALUES ('/Mobius/edu4/led/4-20180312072141789YExF','admin:admin','','1','','1'),('/Mobius/edu4/led/4-20180312072312869HFpc','admin:admin','','1','','1'),('/Mobius/edu4/led/4-20180312072612534DaRE','admin:admin','','1','','1'),('/Mobius/edu4/led/4-20180312073350575kU1T','admin:admin','','1','','1'),('/Mobius/edu4/led/4-20180312080628940zilX','admin:admin','','1','','1'),('/Mobius/edu4/led/4-20180312080841394a0pZ','admin:admin','','1','','1'),('/Mobius/edu4/led/4-201803120817474014w80','admin:admin','','1','','1');
/*!40000 ALTER TABLE `cin` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cnt`
--

DROP TABLE IF EXISTS `cnt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cnt` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `mbs` varchar(45) DEFAULT NULL,
  `mia` varchar(45) DEFAULT NULL,
  `cni` varchar(45) DEFAULT NULL,
  `cbs` varchar(45) DEFAULT NULL,
  `li` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `disr` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  CONSTRAINT `cnt_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cnt`
--

LOCK TABLES `cnt` WRITE;
/*!40000 ALTER TABLE `cnt` DISABLE KEYS */;
INSERT INTO `cnt` VALUES ('/Mobius/ae_test2/container1','C_AE_ID_STEM_1','3153600000','3153600000','31536000','0','0','','',''),('/Mobius/ae_test2/container2','C_AE_ID_STEM_1','3153600000','3153600000','31536000','0','0','','',''),('/Mobius/edu4/co2','Sedu4','3153600000','3153600000','31536000','0','0','','',''),('/Mobius/edu4/led','Sedu4','3153600000','3153600000','31536000','7','7','','',''),('/Mobius/edu4/temp','Sedu4','3153600000','3153600000','31536000','0','0','','',''),('/Mobius/edu4/tvoc','Sedu4','3153600000','3153600000','31536000','0','0','','','');
/*!40000 ALTER TABLE `cnt` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `csr`
--

DROP TABLE IF EXISTS `csr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `csr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `cb` varchar(200) DEFAULT NULL,
  `csi` varchar(200) DEFAULT NULL,
  `mei` varchar(45) DEFAULT NULL,
  `tri` varchar(45) DEFAULT NULL,
  `rr` varchar(45) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `csr_ri_idx` (`ri`),
  CONSTRAINT `csr_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `csr`
--

LOCK TABLES `csr` WRITE;
/*!40000 ALTER TABLE `csr` DISABLE KEYS */;
/*!40000 ALTER TABLE `csr` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `grp`
--

DROP TABLE IF EXISTS `grp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `grp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mt` varchar(45) NOT NULL,
  `cnm` varchar(45) NOT NULL,
  `mnm` varchar(45) NOT NULL,
  `mid` mediumtext DEFAULT NULL,
  `macp` mediumtext DEFAULT NULL,
  `mtv` varchar(45) DEFAULT NULL,
  `csy` varchar(45) DEFAULT NULL,
  `gn` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `grp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `grp`
--

LOCK TABLES `grp` WRITE;
/*!40000 ALTER TABLE `grp` DISABLE KEYS */;
INSERT INTO `grp` VALUES ('/Mobius/ae_test2/grp1','S20180221054413068HDUn','0','2','10','[\"Mobius/ae_test2/container1\"]','\"[]\"','false','1','');
/*!40000 ALTER TABLE `grp` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `lcp`
--

DROP TABLE IF EXISTS `lcp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `lcp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `los` varchar(45) DEFAULT NULL,
  `lou` varchar(45) DEFAULT NULL,
  `lot` varchar(45) DEFAULT NULL,
  `lor` varchar(45) DEFAULT NULL,
  `loi` varchar(45) DEFAULT NULL,
  `lon` varchar(45) DEFAULT NULL,
  `lost` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `lcp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `lcp`
--

LOCK TABLES `lcp` WRITE;
/*!40000 ALTER TABLE `lcp` DISABLE KEYS */;
/*!40000 ALTER TABLE `lcp` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `lookup`
--

DROP TABLE IF EXISTS `lookup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `lookup` (
  `pi` varchar(200) NOT NULL,
  `ty` varchar(8) NOT NULL,
  `ct` varchar(15) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `rn` varchar(45) NOT NULL,
  `lt` varchar(45) NOT NULL,
  `et` varchar(45) DEFAULT NULL,
  `acpi` varchar(200) DEFAULT NULL,
  `lbl` varchar(200) DEFAULT NULL,
  `at` varchar(45) DEFAULT NULL,
  `aa` varchar(45) DEFAULT NULL,
  `st` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `cs` varchar(45) DEFAULT NULL,
  `cnf` varchar(45) DEFAULT NULL,
  `sri` varchar(45) DEFAULT NULL,
  `spi` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`pi`,`ty`,`ct`,`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_lookup_resourcetype` (`ty`),
  KEY `idx_lookup_parentid` (`pi`),
  KEY `idx_lookup_cs` (`cs`),
  KEY `idx_lookup_ct` (`ct`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `lookup`
--

LOCK TABLES `lookup` WRITE;
/*!40000 ALTER TABLE `lookup` DISABLE KEYS */;
INSERT INTO `lookup` VALUES ('','5','20180209T083704','/Mobius','Mobius','20180209T083704','20280209T083704','[]','[\"Mobius\"]','[]','[]','0','3153600000','',NULL,'BJ_2pRcIG',''),('/Mobius','1','20180312T071454','/Mobius/acp-justin','acp-justin','20180312T071454','20210312T071454','[]','[]','[]','[]','0','3153600000','',NULL,'Byz8etiXKG','BJ_2pRcIG'),('/Mobius','14','20180308T093405','/Mobius/nod-justin','nod-justin','20180308T093405','20210308T093405','[]','[]','[]','[]','0','3153600000','',NULL,'B1gc3mtAdz','BJ_2pRcIG'),('/Mobius','2','20180209T084052','/Mobius/edu4','edu4','20180209T084052','20210209T084052','[]','[]','[]','[]','0','3153600000','',NULL,'Sedu4','BJ_2pRcIG'),('/Mobius','2','20180221T054413','/Mobius/ae_test2','ae_test2','20180221T054413','20210221T054413','[\"{{ri}}\"]','[\"key1\",\"key2\"]','[]','[]','0','3153600000','',NULL,'S20180221054413068HDUn','BJ_2pRcIG'),('/Mobius','2','20180308T085333','/Mobius/flavia','flavia','20180308T085333','20210308T085333','[]','[\"key1\",\"key2\"]','[]','[]','0','3153600000','',NULL,'S201803080854241479wjB','BJ_2pRcIG'),('/Mobius/ae_test2','3','20180221T054906','/Mobius/ae_test2/container1','container1','20180221T054906','20210221T054906','[]','[]','[]','[]','0','3153600000','',NULL,'rk458_F9Pf','S20180221054413068HDUn'),('/Mobius/ae_test2','3','20180221T054926','/Mobius/ae_test2/container2','container2','20180221T054926','20210221T054926','[]','[]','[]','[]','0','3153600000','',NULL,'SyVAwdFcDG','S20180221054413068HDUn'),('/Mobius/ae_test2','9','20180221T055244','/Mobius/ae_test2/grp1','grp1','20180221T055944','20210221T055244','[]','[]','[]','[]','1','3153600000','',NULL,'SJD8KFcDf','S20180221054413068HDUn'),('/Mobius/edu4','3','20180209T084054','/Mobius/edu4/co2','co2','20180209T084054','20210209T084054','[]','[\"co2\"]','[]','[]','0','3153600000','',NULL,'rkmks0AcIG','Sedu4'),('/Mobius/edu4','3','20180209T084056','/Mobius/edu4/led','led','20180312T081747','20210209T084056','[]','[\"led\"]','[]','[]','7','3153600000','',NULL,'S1QbiCR98f','Sedu4'),('/Mobius/edu4','3','20180209T084058','/Mobius/edu4/temp','temp','20180209T084058','20210209T084058','[]','[\"temp\"]','[]','[]','0','3153600000','',NULL,'SJQXoRR9Lz','Sedu4'),('/Mobius/edu4','3','20180209T084100','/Mobius/edu4/tvoc','tvoc','20180209T084100','20210209T084100','[]','[\"tvoc\"]','[]','[]','0','3153600000','',NULL,'r17BjCRc8z','Sedu4'),('/Mobius/edu4/led','23','20180312T080623','/Mobius/edu4/led/sub','sub','20180312T080623','20210312T080623','[]','[]','[]','[]','0','3153600000','',NULL,'rJQ_WHnXYM','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T072141','/Mobius/edu4/led/4-20180312072141789YExF','4-20180312072141789YExF','20180312T072141','20210312T072141','[]','[]','[]','[]','1','undefined','1',NULL,'S1mCYcjQYG','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T072312','/Mobius/edu4/led/4-20180312072312869HFpc','4-20180312072312869HFpc','20180312T072312','20210312T072312','[]','[]','[]','[]','2','undefined','1',NULL,'rkXYJjiXtz','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T072612','/Mobius/edu4/led/4-20180312072612534DaRE','4-20180312072612534DaRE','20180312T072612','20210312T072612','[]','[]','[]','[]','3','undefined','1',NULL,'BJ7T9os7Fz','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T073350','/Mobius/edu4/led/4-20180312073350575kU1T','4-20180312073350575kU1T','20180312T073350','20210312T073350','[]','[]','[]','[]','4','undefined','1',NULL,'H1mwDTomFM','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T080628','/Mobius/edu4/led/4-20180312080628940zilX','4-20180312080628940zilX','20180312T080628','20210312T080628','[]','[]','[]','[]','5','undefined','1',NULL,'rJmabH3mFf','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T080841','/Mobius/edu4/led/4-20180312080841394a0pZ','4-20180312080841394a0pZ','20180312T080841','20210312T080841','[]','[]','[]','[]','6','undefined','1',NULL,'Bk7b5BhXtG','S1QbiCR98f'),('/Mobius/edu4/led','4','20180312T081747','/Mobius/edu4/led/4-201803120817474014w80','4-201803120817474014w80','20180312T081747','20210312T081747','[]','[]','[]','[]','7','undefined','1',NULL,'r1QX2vh7FM','S1QbiCR98f'),('/Mobius/nod-justin','13','20180308T093513','/Mobius/nod-justin/fwr-mgo1','fwr-mgo1','20180308T093513','20210308T093513','[]','[\"key1\"]','[]','[]','0','3153600000','',NULL,'ByeGWVFRuM','B1gc3mtAdz');
/*!40000 ALTER TABLE `lookup` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mgo`
--

DROP TABLE IF EXISTS `mgo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
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
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mgo_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mgo`
--

LOCK TABLES `mgo` WRITE;
/*!40000 ALTER TABLE `mgo` DISABLE KEYS */;
INSERT INTO `mgo` VALUES ('/Mobius/nod-justin/fwr-mgo1','1001','','','','1.0.0','test','http://203.253.128.151:7579/firmware','true','\"\"',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `mgo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `mms`
--

DROP TABLE IF EXISTS `mms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `mms` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sid` varchar(45) DEFAULT NULL,
  `soid` varchar(45) DEFAULT NULL,
  `stid` varchar(45) DEFAULT NULL,
  `asd` varchar(45) DEFAULT NULL,
  `osd` varchar(45) DEFAULT NULL,
  `sst` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mms_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mms`
--

LOCK TABLES `mms` WRITE;
/*!40000 ALTER TABLE `mms` DISABLE KEYS */;
/*!40000 ALTER TABLE `mms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `nod`
--

DROP TABLE IF EXISTS `nod`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `nod` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ni` varchar(45) NOT NULL,
  `hcl` varchar(45) DEFAULT NULL,
  `mgca` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `nod_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `nod`
--

LOCK TABLES `nod` WRITE;
/*!40000 ALTER TABLE `nod` DISABLE KEYS */;
INSERT INTO `nod` VALUES ('/Mobius/nod-justin','node-0.2.481.1.12345','','');
/*!40000 ALTER TABLE `nod` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `req`
--

DROP TABLE IF EXISTS `req`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `req` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `op` varchar(45) NOT NULL,
  `tg` varchar(45) NOT NULL,
  `org` varchar(45) NOT NULL,
  `rid` varchar(45) NOT NULL,
  `mi` varchar(45) DEFAULT NULL,
  `pc` longtext DEFAULT NULL,
  `rs` varchar(45) DEFAULT NULL,
  `ors` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `req_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `req`
--

LOCK TABLES `req` WRITE;
/*!40000 ALTER TABLE `req` DISABLE KEYS */;
/*!40000 ALTER TABLE `req` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `smd`
--

DROP TABLE IF EXISTS `smd`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `smd` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `dcrp` longtext DEFAULT NULL,
  `or` mediumtext DEFAULT NULL,
  `dsp` longtext DEFAULT NULL,
  `soe` varchar(200) DEFAULT NULL,
  `rels` varchar(400) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `sd_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `smd`
--

LOCK TABLES `smd` WRITE;
/*!40000 ALTER TABLE `smd` DISABLE KEYS */;
/*!40000 ALTER TABLE `smd` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sri`
--

DROP TABLE IF EXISTS `sri`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
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
-- Dumping data for table `sri`
--

LOCK TABLES `sri` WRITE;
/*!40000 ALTER TABLE `sri` DISABLE KEYS */;
INSERT INTO `sri` VALUES ('/Mobius','BJ_2pRcIG'),('/Mobius/acp-justin','Byz8etiXKG'),('/Mobius/ae_test2','S20180221054413068HDUn'),('/Mobius/ae_test2/container1','rk458_F9Pf'),('/Mobius/ae_test2/container2','SyVAwdFcDG'),('/Mobius/ae_test2/grp1','SJD8KFcDf'),('/Mobius/edu4','Sedu4'),('/Mobius/edu4/co2','rkmks0AcIG'),('/Mobius/edu4/led','S1QbiCR98f'),('/Mobius/edu4/led/4-20180312072141789YExF','S1mCYcjQYG'),('/Mobius/edu4/led/4-20180312072312869HFpc','rkXYJjiXtz'),('/Mobius/edu4/led/4-20180312072612534DaRE','BJ7T9os7Fz'),('/Mobius/edu4/led/4-20180312073350575kU1T','H1mwDTomFM'),('/Mobius/edu4/led/4-20180312080628940zilX','rJmabH3mFf'),('/Mobius/edu4/led/4-20180312080841394a0pZ','Bk7b5BhXtG'),('/Mobius/edu4/led/4-201803120817474014w80','r1QX2vh7FM'),('/Mobius/edu4/led/sub','rJQ_WHnXYM'),('/Mobius/edu4/temp','SJQXoRR9Lz'),('/Mobius/edu4/tvoc','r17BjCRc8z'),('/Mobius/flavia','S201803080854241479wjB'),('/Mobius/nod-justin','B1gc3mtAdz'),('/Mobius/nod-justin/fwr-mgo1','ByeGWVFRuM');
/*!40000 ALTER TABLE `sri` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sub`
--

DROP TABLE IF EXISTS `sub`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sub` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pi` varchar(400) DEFAULT NULL,
  `enc` varchar(45) DEFAULT NULL,
  `exc` varchar(45) DEFAULT NULL,
  `nu` varchar(200) DEFAULT NULL,
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
  `cr` varchar(45) DEFAULT NULL,
  `su` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  CONSTRAINT `sub_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sub`
--

LOCK TABLES `sub` WRITE;
/*!40000 ALTER TABLE `sub` DISABLE KEYS */;
INSERT INTO `sub` VALUES ('/Mobius/edu4/led/sub','/Mobius/edu4/led','{\"net\":[3]}','','[\"http://192.168.0.104:9727/noti?ct=xml\"]','','','{}','','','','','','2','','Sedu4','');
/*!40000 ALTER TABLE `sub` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tm`
--

DROP TABLE IF EXISTS `tm`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tm` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `tltm` varchar(45) DEFAULT NULL,
  `text` varchar(45) DEFAULT NULL,
  `tct` varchar(45) DEFAULT NULL,
  `tept` varchar(45) DEFAULT NULL,
  `tmd` varchar(45) DEFAULT NULL,
  `tltp` varchar(45) DEFAULT NULL,
  `tctl` varchar(45) DEFAULT NULL,
  `tst` varchar(45) DEFAULT NULL,
  `tmr` varchar(45) DEFAULT NULL,
  `tmh` varchar(45) DEFAULT NULL,
  `rqps` tinytext DEFAULT NULL,
  `rsps` tinytext DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tm_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tm`
--

LOCK TABLES `tm` WRITE;
/*!40000 ALTER TABLE `tm` DISABLE KEYS */;
/*!40000 ALTER TABLE `tm` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tr`
--

DROP TABLE IF EXISTS `tr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `tid` varchar(45) NOT NULL,
  `tctl` varchar(45) DEFAULT NULL,
  `tst` varchar(45) DEFAULT NULL,
  `tltm` varchar(45) DEFAULT NULL,
  `text` varchar(45) DEFAULT NULL,
  `tct` varchar(45) DEFAULT NULL,
  `tltp` varchar(45) DEFAULT NULL,
  `trqp` tinytext NOT NULL,
  `trsp` tinytext DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tr_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tr`
--

LOCK TABLES `tr` WRITE;
/*!40000 ALTER TABLE `tr` DISABLE KEYS */;
/*!40000 ALTER TABLE `tr` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ts`
--

DROP TABLE IF EXISTS `ts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ts` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `mbs` varchar(45) DEFAULT NULL,
  `mia` varchar(45) DEFAULT NULL,
  `cni` varchar(45) DEFAULT NULL,
  `cbs` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `pei` varchar(45) DEFAULT NULL,
  `mdd` varchar(45) DEFAULT NULL,
  `mdn` varchar(45) DEFAULT NULL,
  `mdlt` longtext DEFAULT NULL,
  `mdc` varchar(45) DEFAULT NULL,
  `mdt` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `ts_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ts`
--

LOCK TABLES `ts` WRITE;
/*!40000 ALTER TABLE `ts` DISABLE KEYS */;
/*!40000 ALTER TABLE `ts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tsi`
--

DROP TABLE IF EXISTS `tsi`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tsi` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `dgt` varchar(45) DEFAULT NULL,
  `con` varchar(45) DEFAULT NULL,
  `sqn` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tsi_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tsi`
--

LOCK TABLES `tsi` WRITE;
/*!40000 ALTER TABLE `tsi` DISABLE KEYS */;
/*!40000 ALTER TABLE `tsi` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2018-03-13  0:57:28
